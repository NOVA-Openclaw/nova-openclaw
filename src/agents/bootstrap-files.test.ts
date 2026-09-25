import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAutoCleanupTempDirTracker } from "../../test/helpers/temp-dir.js";
import { makeUserMessage } from "../../test/helpers/user-message.js";
import {
  upsertSessionEntryCore,
  type SessionTranscriptRuntimeTarget,
} from "../config/sessions/session-accessor.js";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import {
  clearInternalHooks,
  registerInternalHook,
  type AgentBootstrapHookContext,
} from "../hooks/internal-hooks.js";
import { closeOpenClawStateDatabaseForTest } from "../state/openclaw-state-db.js";
import { makeTempWorkspace } from "../test-helpers/workspace.js";
import { withEnvAsync } from "../test-utils/env.js";
import {
  createOpenClawTestState,
  type OpenClawTestState,
} from "../test-utils/openclaw-test-state.js";
import { useSessionStoreTempDirs } from "../test-utils/session-state-cleanup.js";
import { resolveBootstrapContextForDiagnostics } from "./bootstrap-files-diagnostics.js";
import {
  FULL_BOOTSTRAP_COMPLETED_CUSTOM_TYPE,
  hasCompletedBootstrapTurn,
  makeBootstrapWarn,
  resolveBootstrapContextForRun,
  resolveBootstrapFilesForRun,
  resolveContextInjectionMode,
} from "./bootstrap-files.js";
import { buildBootstrapContextFiles } from "./embedded-agent-helpers/bootstrap.js";
import { createRemoteShellSandboxFsBridge } from "./sandbox/remote-fs-bridge.js";
import { createLocalRemoteShellScriptRunner } from "./sandbox/remote-fs-bridge.test-helpers.js";
import { createSandboxTestContext } from "./sandbox/test-fixtures.js";
import { SessionManager } from "./sessions/session-manager.js";
import { registerAgentWorkspaceAccess } from "./workspace-access.js";
import { resetLegacyWorkspaceStateCheckForTest } from "./workspace-legacy-state.test-support.js";
import { mergeWorkspaceSetupState } from "./workspace-state-store.js";
import {
  DEFAULT_MEMORY_FILENAME,
  DEFAULT_USER_FILENAME,
  loadExtraBootstrapFilesWithDiagnostics,
  type WorkspaceBootstrapFile,
} from "./workspace.js";

const memoryRuntimeMocks = vi.hoisted(() => ({ classifyWorkspacePaths: vi.fn() }));

vi.mock("../plugins/memory-runtime.js", () => ({
  classifyActiveMemoryWorkspacePaths: (...args: unknown[]) =>
    memoryRuntimeMocks.classifyWorkspacePaths(...args),
}));

let testState: OpenClawTestState | undefined;
const tempDirs = useAutoCleanupTempDirTracker(afterEach);

function registerFilesHook(
  files: (context: AgentBootstrapHookContext) => WorkspaceBootstrapFile[],
) {
  registerInternalHook("agent:bootstrap", (event) => {
    const context = event.context as AgentBootstrapHookContext;
    context.bootstrapFiles = [...context.bootstrapFiles, ...files(context)];
  });
}

function bootstrapFile(name: WorkspaceBootstrapFile["name"], filePath: string, content: string) {
  return { name, path: filePath, content, missing: false };
}

function registerNamedBootstrapFileHook(
  relativePath = "MEMORY.md",
  name: WorkspaceBootstrapFile["name"] = "MEMORY.md",
  content = "hook memory",
) {
  registerFilesHook(({ workspaceDir }) => [
    bootstrapFile(name, path.join(workspaceDir, relativePath), content),
  ]);
}

function registerLoadedBootstrapFilesHook(
  relativePaths: string[],
  name?: WorkspaceBootstrapFile["name"],
) {
  registerInternalHook("agent:bootstrap", async (event) => {
    const context = event.context as AgentBootstrapHookContext;
    const { files } = await loadExtraBootstrapFilesWithDiagnostics(
      context.workspaceDir,
      relativePaths,
    );
    if (name) {
      for (const file of files) {
        file.name = name;
      }
    }
    context.bootstrapFiles = [...context.bootstrapFiles, ...files];
  });
}

async function createDirectoryAlias(workspaceDir: string, targetDir: string, aliasName: string) {
  const aliasDir = path.join(workspaceDir, aliasName);
  await fs.symlink(targetDir, aliasDir, process.platform === "win32" ? "junction" : "dir");
  return aliasDir;
}

async function writeFiles(workspaceDir: string, files: Record<string, string>) {
  await Promise.all(
    Object.entries(files).map(async ([name, content]) => {
      const filePath = path.join(workspaceDir, name);
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, content, "utf8");
    }),
  );
}

async function workspace(files: Record<string, string> = {}) {
  const workspaceDir = await makeTempWorkspace("openclaw-bootstrap-");
  await writeFiles(workspaceDir, files);
  return workspaceDir;
}

async function memoryAliases(remote: boolean) {
  const workspaceDir = await workspace();
  const sourceDir = remote
    ? await fs.realpath(tempDirs.make("openclaw-bootstrap-harness-"))
    : workspaceDir;
  const content = remote ? "same memory bytes" : "nested memory";
  await writeFiles(sourceDir, {
    "MEMORY.md": remote ? content : "private memory",
    "nested/MEMORY.md": content,
    ...(remote
      ? {}
      : {
          "AGENTS.md": "rules",
          "SOUL.md": "persona",
          "IDENTITY.md": "identity",
          "USER.md": "user",
        }),
  });
  await createDirectoryAlias(sourceDir, sourceDir, "root-alias");
  await createDirectoryAlias(sourceDir, path.join(sourceDir, "nested"), "nested-alias");
  if (remote) {
    await writeFiles(workspaceDir, { "MEMORY.md": "Gateway decoy" });
  }
  const release = remote
    ? registerAgentWorkspaceAccess(workspaceDir, {
        bridge: createRemoteShellSandboxFsBridge({
          sandbox: createSandboxTestContext({
            overrides: { workspaceDir, agentWorkspaceDir: workspaceDir },
          }),
          runtime: {
            remoteWorkspaceDir: sourceDir,
            remoteAgentWorkspaceDir: sourceDir,
            runRemoteShellScript: createLocalRemoteShellScriptRunner(),
          },
        }),
      })
    : () => {};
  return { workspaceDir, content, release };
}

async function writeCompletedWorkspaceState(workspaceDir: string): Promise<void> {
  await mergeWorkspaceSetupState(workspaceDir, {
    bootstrapSeededAt: "2026-05-16T00:00:00.000Z",
    setupCompletedAt: "2026-05-16T00:00:01.000Z",
  });
}

describe("resolveBootstrapFilesForRun", () => {
  beforeEach(async () => {
    clearInternalHooks();
    resetLegacyWorkspaceStateCheckForTest();
    memoryRuntimeMocks.classifyWorkspacePaths
      .mockReset()
      .mockResolvedValue({ status: "unavailable" });
    testState = await createOpenClawTestState({
      layout: "state-only",
      prefix: "openclaw-bootstrap-state-",
    });
  });

  it.each([
    ["untrusted", "owner", false, true],
    ["agent", undefined, true, false],
    ["unsupported", undefined, false, false],
  ] as const)("filters root provenance %s/%s", async (memoryOrigin, userOrigin, memory, user) => {
    const workspaceDir = await workspace({
      "MEMORY.md": "tainted memory",
      "USER.md": "trusted user",
    });
    if (memoryOrigin === "untrusted") {
      registerNamedBootstrapFileHook(DEFAULT_MEMORY_FILENAME);
    }
    memoryRuntimeMocks.classifyWorkspacePaths.mockResolvedValue(
      memoryOrigin === "unsupported"
        ? { status: "unsupported" }
        : {
            status: "classified",
            classifications: [
              { relativePath: DEFAULT_MEMORY_FILENAME, originClass: memoryOrigin },
              ...(userOrigin
                ? [{ relativePath: DEFAULT_USER_FILENAME, originClass: userOrigin }]
                : []),
            ],
          },
    );
    const warnings: string[] = [];
    const files = await resolveBootstrapFilesForRun({
      workspaceDir,
      config: {},
      agentId: "main",
      warn: (message) => warnings.push(message),
    });
    const names = new Set(files.map((file) => file.name));
    expect(names.has(DEFAULT_MEMORY_FILENAME)).toBe(memory);
    expect(names.has(DEFAULT_USER_FILENAME)).toBe(user);
    if (memoryOrigin === "unsupported") {
      expect(warnings).toContain(
        "excluding automatic memory context: selected memory runtime does not support provenance classification",
      );
    }
  });
  afterEach(async () => {
    clearInternalHooks();
    closeOpenClawStateDatabaseForTest();
    resetLegacyWorkspaceStateCheckForTest();
    await testState?.cleanup();
    testState = undefined;
  });

  it("drops malformed hook files with missing/invalid paths", async () => {
    registerFilesHook(
      ({ workspaceDir }) =>
        [
          {
            name: "EXTRA.md",
            filePath: path.join(workspaceDir, "BROKEN.md"),
          },
          { name: "EXTRA.md", path: 123 },
          { name: "EXTRA.md", path: "   " },
        ] as unknown as WorkspaceBootstrapFile[],
    );

    const workspaceDir = await makeTempWorkspace("openclaw-bootstrap-");
    const warnings: string[] = [];
    const files = await resolveBootstrapFilesForRun({
      workspaceDir,
      warn: (message) => warnings.push(message),
    });

    expect(files.map((file) => file.name)).not.toContain("EXTRA.md");
    expect(warnings).toHaveLength(3);
    expect(warnings[0]).toContain('missing or invalid "path" field');
  });

  it("dedupes hook-injected bootstrap paths relative to the workspace", async () => {
    registerFilesHook(({ workspaceDir }) => [
      bootstrapFile("AGENTS.md", "AGENTS.md", "duplicate relative hook content"),
      bootstrapFile(
        "AGENTS.md",
        path.join(workspaceDir, ".", "AGENTS.md"),
        "duplicate absolute hook content",
      ),
    ]);

    const workspaceDir = await workspace({ "AGENTS.md": "workspace rules" });
    const agentsPath = path.join(workspaceDir, "AGENTS.md");

    const context = await resolveBootstrapContextForRun({ workspaceDir });
    const agentsContextFiles = context.contextFiles.filter((file) => file.path === agentsPath);
    expect(agentsContextFiles.map((file) => file.content)).toEqual(["workspace rules"]);
  });

  it("refreshes USER.md on every turn for long-lived sessions", async () => {
    const workspaceDir = await makeTempWorkspace("openclaw-bootstrap-");
    const userPath = path.join(workspaceDir, "USER.md");
    const sessionKey = `agent:main:webchat:direct:${randomUUID()}`;
    await fs.writeFile(userPath, "Prefer concise answers.", "utf8");
    const first = await resolveBootstrapFilesForRun({ workspaceDir, sessionKey });

    await fs.writeFile(userPath, "Prefer detailed answers.", "utf8");
    const second = await resolveBootstrapFilesForRun({ workspaceDir, sessionKey });

    expect(first.find((file) => file.name === "USER.md")?.content).toBe("Prefer concise answers.");
    expect(second.find((file) => file.name === "USER.md")?.content).toBe(
      "Prefer detailed answers.",
    );
  });

  it("filters completed root BOOTSTRAP.md but keeps nested hooks in a home-relative workspace", async () => {
    registerNamedBootstrapFileHook("BOOTSTRAP.md", "BOOTSTRAP.md", "stale ritual");
    registerNamedBootstrapFileHook("packages/core/BOOTSTRAP.md", "BOOTSTRAP.md", "package ritual");
    const parentDir = await makeTempWorkspace("openclaw-bootstrap-home-");
    const workspaceDir = path.join(parentDir, "workspace");
    await writeFiles(workspaceDir, {
      "AGENTS.md": "rules",
      "BOOTSTRAP.md": "stale ritual",
      "packages/core/BOOTSTRAP.md": "package ritual",
    });
    await writeCompletedWorkspaceState(workspaceDir);
    const files = await withEnvAsync({ OPENCLAW_HOME: parentDir }, async () =>
      resolveBootstrapFilesForRun({ workspaceDir: "~/workspace" }),
    );
    expect(files.map((file) => file.name)).toContain("AGENTS.md");
    expect(files.map((file) => path.relative(workspaceDir, file.path))).toContain(
      path.join("packages", "core", "BOOTSTRAP.md"),
    );
    expect(files.map((file) => file.path)).not.toContain(path.join(workspaceDir, "BOOTSTRAP.md"));
  });

  const memoryModes = [
    { mode: "direct", chatType: "direct", sessionKey: "agent:main:opaque:binding" },
    { mode: "group", chatType: "group", sessionKey: "agent:main:opaque:binding" },
    { mode: "channel", chatType: "channel", sessionKey: "agent:main:opaque:binding" },
    { mode: "subagent", chatType: "direct", sessionKey: "agent:main:subagent:worker" },
    { mode: "cron", chatType: "direct", sessionKey: "agent:main:cron:daily:run:run-1" },
  ] as const;
  describe.each([false, true])("remote memory = %s", (remote) => {
    it.runIf(!remote || process.platform !== "win32").each(memoryModes)(
      "filters root aliases but preserves nested memory for $mode",
      async ({ mode, chatType, sessionKey }) => {
        const { workspaceDir, content, release } = await memoryAliases(remote);
        try {
          registerNamedBootstrapFileHook(
            "MEMORY.md",
            mode === "subagent" ? "AGENTS.md" : "SOUL.md",
          );
          registerLoadedBootstrapFilesHook(
            ["root-alias/MEMORY.md", "nested-alias/MEMORY.md"],
            mode === "subagent" ? "AGENTS.md" : mode === "cron" ? "SOUL.md" : undefined,
          );
          const files = await resolveBootstrapFilesForRun({ workspaceDir, sessionKey, chatType });
          const paths = files.map((file) => file.path);
          const rootAliasPath = path.join(workspaceDir, "root-alias/MEMORY.md");
          const nestedPath = path.join(workspaceDir, "nested-alias/MEMORY.md");
          expect(paths.includes(rootAliasPath)).toBe(mode === "direct");
          expect(paths.includes(path.join(workspaceDir, "MEMORY.md"))).toBe(mode === "direct");
          expect(files.find((file) => file.path === nestedPath)).toMatchObject({
            content,
            missing: false,
          });
          if (remote) {
            expect(files.map((file) => file.name)).not.toContain(DEFAULT_USER_FILENAME);
            expect(files.some((file) => file.content === "Gateway decoy")).toBe(false);
          } else if (mode !== "subagent" && mode !== "cron") {
            expect(paths.indexOf(nestedPath)).toBeGreaterThan(
              files.findIndex((file) => file.name === "SOUL.md"),
            );
          } else {
            expect(
              files.filter((file) => file.path !== nestedPath).map((file) => file.name),
            ).toEqual(
              mode === "subagent"
                ? ["AGENTS.md"]
                : ["AGENTS.md", "SOUL.md", "IDENTITY.md", "USER.md"],
            );
          }
        } finally {
          release();
        }
      },
    );
  });

  it("keeps missing hook records without source identity when policy allows them", async () => {
    const workspaceDir = await workspace({ "MEMORY.md": "private memory" });
    registerFilesHook(({ workspaceDir: rootDir }) => [
      {
        name: "SOUL.md",
        path: path.join(rootDir, "generated", "SOUL.md"),
        missing: true,
      },
    ]);

    const files = await resolveBootstrapFilesForRun({
      workspaceDir,
      sessionKey: "agent:main:opaque:binding",
      chatType: "channel",
    });

    expect(files).toContainEqual({
      name: "SOUL.md",
      path: path.join(workspaceDir, "generated", "SOUL.md"),
      missing: true,
    });
  });
});

describe("resolveBootstrapContextForRun", () => {
  beforeEach(() => clearInternalHooks());
  afterEach(() => clearInternalHooks());

  it("keeps bootstrap context empty in lightweight scheduled mode", async () => {
    const workspaceDir = await workspace({ "SOUL.md": "persona" });

    const files = await resolveBootstrapFilesForRun({
      workspaceDir,
      contextMode: "lightweight",
      runKind: "cron",
    });

    expect(files).toStrictEqual([]);
  });
});

describe("resolveBootstrapContextForDiagnostics", () => {
  beforeEach(() => clearInternalHooks());
  afterEach(() => clearInternalHooks());

  it.each([
    ["bundled", true],
    ["disabled", false],
    ["managed import failure", false],
    ["managed missing handler", true],
  ] as const)("projects declared files for %s without executing hooks", async (mode, projects) => {
    const workspaceDir = await fs.realpath(
      await workspace({ "packages/core/AGENTS.md": "extra agents" }),
    );
    const extraPath = path.join(workspaceDir, "packages/core/AGENTS.md");
    const handler = vi.fn(() => {
      throw new Error("diagnostics must not execute hook code");
    });
    registerInternalHook("agent:bootstrap", handler);
    const internal: NonNullable<NonNullable<OpenClawConfig["hooks"]>["internal"]> = {
      enabled: mode === "disabled" ? false : undefined,
      entries: { "bootstrap-extra-files": { enabled: true, paths: ["packages/*/AGENTS.md"] } },
    };
    if (mode.startsWith("managed")) {
      const managedHooksDir = await makeTempWorkspace("openclaw-managed-hooks-");
      await writeFiles(managedHooksDir, {
        "bootstrap-extra-files/HOOK.md": [
          "---",
          "name: bootstrap-extra-files",
          "description: managed replacement",
          'metadata: { "openclaw": { "events": ["agent:bootstrap"] } }',
          "---",
          "",
        ].join("\n"),
        ...(mode === "managed import failure"
          ? { "bootstrap-extra-files/handler.js": 'throw new Error("must not import");' }
          : {}),
      });
      internal.load = { extraDirs: [managedHooksDir] };
    }
    const result = await resolveBootstrapContextForDiagnostics({
      workspaceDir,
      config: { hooks: { internal } },
    });
    expect(handler).not.toHaveBeenCalled();
    if (projects) {
      expect(result.contextFiles).toContainEqual({ path: extraPath, content: "extra agents" });
    } else {
      expect(result.bootstrapFiles.map((file) => file.path)).not.toContain(extraPath);
    }
  });
});

describe("hasCompletedBootstrapTurn", () => {
  const sessionDirs = useSessionStoreTempDirs(afterAll, "openclaw-bootstrap-turn-");
  let tmpDir: string;
  let sessionTarget: SessionTranscriptRuntimeTarget;
  let sessionManager: SessionManager;

  beforeEach(async () => {
    tmpDir = sessionDirs.make();
    sessionTarget = {
      agentId: "main",
      sessionId: randomUUID(),
      sessionKey: "agent:main:bootstrap-turn",
      storePath: path.join(tmpDir, "sessions.json"),
    };
    await upsertSessionEntryCore(sessionTarget, {
      sessionId: sessionTarget.sessionId,
      updatedAt: Date.now(),
    });
    sessionManager = SessionManager.open(sessionTarget, tmpDir);
  });

  it("returns false without a complete SQLite transcript identity", async () => {
    expect(await hasCompletedBootstrapTurn()).toBe(false);
    expect(await hasCompletedBootstrapTurn({ ...sessionTarget, storePath: undefined })).toBe(false);
  });

  it("returns false when no full bootstrap marker has been recorded", async () => {
    sessionManager.appendMessage({ role: "user", content: "hello", timestamp: 1 });
    sessionManager.appendCustomEntry("openclaw:unrelated", { timestamp: 2 });

    expect(await hasCompletedBootstrapTurn(sessionTarget)).toBe(false);
  });

  it.each(["compaction", "reset", "branch"] as const)(
    "invalidates the marker after %s",
    async (boundary) => {
      const firstEntryId = sessionManager.appendMessage(makeUserMessage("hello", 1));
      sessionManager.appendCustomEntry(FULL_BOOTSTRAP_COMPLETED_CUSTOM_TYPE, { timestamp: 2 });
      expect(await hasCompletedBootstrapTurn(sessionTarget)).toBe(true);
      if (boundary === "compaction") {
        sessionManager.appendCompaction("trimmed", firstEntryId, 10);
      } else if (boundary === "reset") {
        sessionManager.appendResetBoundary("reset");
      } else {
        sessionManager.appendLeafControl({ targetId: firstEntryId, appendParentId: firstEntryId });
      }
      expect(await hasCompletedBootstrapTurn(sessionTarget)).toBe(false);
      if (boundary !== "compaction") {
        return;
      }
      sessionManager.appendCustomEntry(FULL_BOOTSTRAP_COMPLETED_CUSTOM_TYPE, { timestamp: 3 });

      const hostExec = vi.spyOn(DatabaseSync.prototype, "exec");
      try {
        expect(await hasCompletedBootstrapTurn(sessionTarget)).toBe(true);
        expect(hostExec.mock.calls.filter(([sql]) => /^BEGIN\b/iu.test(sql))).toEqual([]);
      } finally {
        hostExec.mockRestore();
      }
    },
  );
});

describe("makeBootstrapWarn", () => {
  it("keeps content revisions distinct when decorating truncation warnings", () => {
    const warnings: string[] = [];
    const workspaceDir = `/tmp/${randomUUID()}`;
    for (const { sessionLabel, content } of [
      { sessionLabel: "first", content: "a" },
      { sessionLabel: "second", content: "a" },
      { sessionLabel: "first", content: "b" },
    ]) {
      buildBootstrapContextFiles(
        [bootstrapFile("AGENTS.md", `${workspaceDir}/AGENTS.md`, content.repeat(1000))],
        {
          maxChars: 200,
          warn: makeBootstrapWarn({
            sessionLabel,
            workspaceDir,
            warn: (message) => warnings.push(message),
          }),
        },
      );
    }
    expect(warnings).toEqual([
      "workspace bootstrap file AGENTS.md is 1000 chars (limit 200); truncating in injected context (sessionKey=first)",
      "workspace bootstrap file AGENTS.md is 1000 chars (limit 200); truncating in injected context (sessionKey=first)",
    ]);
  });

  it("deduplicates repeated warnings for the same session and message", () => {
    const warnings: string[] = [];
    const warn = makeBootstrapWarn({
      sessionLabel: "agent:main:test-session",
      workspaceDir: `/tmp/${randomUUID()}`,
      warn: (message) => warnings.push(message),
    });

    warn?.("workspace bootstrap file MEMORY.md is 36697 chars (limit 20000); truncating");
    warn?.("workspace bootstrap file MEMORY.md is 36697 chars (limit 20000); truncating");

    expect(warnings).toEqual([
      "workspace bootstrap file MEMORY.md is 36697 chars (limit 20000); truncating (sessionKey=agent:main:test-session)",
    ]);
  });
});

describe("TC-212-3: synthetic bootstrap path identifiers", () => {
  beforeEach(() => clearInternalHooks());
  afterEach(() => clearInternalHooks());

  function registerSyntheticPathHook(pathValue: string, name = "SYNTHETIC.md") {
    registerInternalHook("agent:bootstrap", (event) => {
      const context = event.context as AgentBootstrapHookContext;
      context.bootstrapFiles = [
        ...context.bootstrapFiles,
        {
          name,
          path: pathValue,
          content: "synthetic",
          missing: false,
        } as unknown as WorkspaceBootstrapFile,
      ];
    });
  }

  it("TC-212-3-U-01: preserves db:AGENT/HEARTBEAT.md synthetic path unchanged", async () => {
    registerSyntheticPathHook("db:AGENT/HEARTBEAT.md", "HEARTBEAT_DB.md");
    const workspaceDir = await makeTempWorkspace("openclaw-bootstrap-synthetic-");
    const files = await resolveBootstrapFilesForRun({ workspaceDir });
    const heartbeat = files.find((f) => f.path === "db:AGENT/HEARTBEAT.md");

    expect(heartbeat?.path).toBe("db:AGENT/HEARTBEAT.md");
    // Kill-check proxy: if the synthetic bypass were removed, path.resolve would turn this
    // into an absolute filesystem path like <workspaceRoot>/db:AGENT/HEARTBEAT.md.
    expect(heartbeat?.path).not.toMatch(/^\//);
    expect(heartbeat?.path).not.toContain(workspaceDir);
  });

  it.each([
    ["db:UNIVERSAL/USER.md", "USER_UNIVERSAL.md"],
    ["db:GLOBAL/COMMUNICATION.md", "COMMUNICATION.md"],
    ["db:DOMAIN:Quality Assurance/AB_TESTING_METHODOLOGY.md", "AB_TESTING.md"],
    ["db:WORKFLOW:SE-openclaw-test/WORKFLOW.md", "WORKFLOW_SYNTH.md"],
    ["db:agent/SOUL.md", "SOUL_AGENT.md"],
  ])("TC-212-3-U-02: preserves synthetic path %s unchanged", async (syntheticPath, uniqueName) => {
    registerSyntheticPathHook(syntheticPath, uniqueName);
    const workspaceDir = await makeTempWorkspace("openclaw-bootstrap-synthetic-");
    const files = await resolveBootstrapFilesForRun({ workspaceDir });
    const file = files.find((f) => f.path === syntheticPath);

    expect(file).toBeDefined();
    expect(file?.path).toBe(syntheticPath);
    expect(file?.path).not.toMatch(/^\//);
  });

  it("TC-212-3-U-03: preserves fallback:UNIVERSAL_SEED.md synthetic path unchanged", async () => {
    registerSyntheticPathHook("fallback:UNIVERSAL_SEED.md", "UNIVERSAL_SEED.md");
    const workspaceDir = await makeTempWorkspace("openclaw-bootstrap-synthetic-");
    const files = await resolveBootstrapFilesForRun({ workspaceDir });
    const file = files.find((f) => f.path === "fallback:UNIVERSAL_SEED.md");

    expect(file?.path).toBe("fallback:UNIVERSAL_SEED.md");
  });

  it("TC-212-3-U-04: preserves emergency:RECOVERY.md synthetic path unchanged", async () => {
    registerSyntheticPathHook("emergency:RECOVERY.md", "RECOVERY.md");
    const workspaceDir = await makeTempWorkspace("openclaw-bootstrap-synthetic-");
    const files = await resolveBootstrapFilesForRun({ workspaceDir });
    const file = files.find((f) => f.path === "emergency:RECOVERY.md");

    expect(file?.path).toBe("emergency:RECOVERY.md");
  });

  it("TC-212-3-U-05: still resolves normal workspace-relative path AGENTS.md normally", async () => {
    const workspaceDir = await makeTempWorkspace("openclaw-bootstrap-synthetic-");
    await fs.writeFile(path.join(workspaceDir, "AGENTS.md"), "rules", "utf8");

    const files = await resolveBootstrapFilesForRun({ workspaceDir });
    const agents = files.find((f) => f.name === "AGENTS.md");

    expect(agents?.path).toBe(path.join(workspaceDir, "AGENTS.md"));
    expect(path.isAbsolute(agents?.path ?? "")).toBe(true);
  });

  it.each([["foo/db:bar.md"], [":leading.md"], ["1db:thing.md"]])(
    "TC-212-3-U-06/07/08: non-synthetic path %s goes through filesystem resolution",
    async (nonSyntheticPath) => {
      registerSyntheticPathHook(nonSyntheticPath, "weird.md");
      const workspaceDir = await makeTempWorkspace("openclaw-bootstrap-synthetic-");
      const files = await resolveBootstrapFilesForRun({ workspaceDir });
      const file = files.find((f) => f.name === "weird.md");

      if (file) {
        // Path must have been resolved to an absolute filesystem path, not the raw input.
        expect(path.isAbsolute(file.path)).toBe(true);
        expect(file.path).not.toBe(nonSyntheticPath);
      }
      // If the sanitizer dropped the file, that is also acceptable — the key point is it
      // did NOT pass through as an opaque synthetic identifier.
    },
  );

  it.each([
    ["C:\\Users\\druid\\file.md"],
    ["C:/Users/druid/file.md"],
    ["c:\\Users\\druid\\file.md"],
  ])(
    "TC-212-3-U-09: Windows drive-letter path %s is not treated as synthetic",
    async (windowsPath) => {
      registerSyntheticPathHook(windowsPath, "windows.md");
      const workspaceDir = await makeTempWorkspace("openclaw-bootstrap-synthetic-");
      const files = await resolveBootstrapFilesForRun({ workspaceDir });
      const file = files.find((f) => f.name === "windows.md");

      if (file) {
        // On POSIX test runners this resolves under the workspace root; on Windows it would
        // be an absolute drive path. Either way it is NOT the raw synthetic-looking string.
        expect(file.path).not.toBe(windowsPath);
      }
    },
  );

  it("TC-212-3-U-09: db:\\foo remains synthetic because the prefix is two characters", async () => {
    registerSyntheticPathHook("db:\\foo", "db-slash.md");
    const workspaceDir = await makeTempWorkspace("openclaw-bootstrap-synthetic-");
    const files = await resolveBootstrapFilesForRun({ workspaceDir });
    const file = files.find((f) => f.name === "db-slash.md");

    expect(file?.path).toBe("db:\\foo");
  });

  it("TC-212-3-U-10/11: missing/empty/whitespace paths hit the existing guard before synthetic check", async () => {
    registerInternalHook("agent:bootstrap", (event) => {
      const context = event.context as AgentBootstrapHookContext;
      context.bootstrapFiles = [
        ...context.bootstrapFiles,
        { name: "UNDEFINED.md", path: undefined, content: "bad", missing: false },
        { name: "NULL.md", path: null, content: "bad", missing: false },
        { name: "NUMBER.md", path: 123, content: "bad", missing: false },
        { name: "EMPTY.md", path: "", content: "bad", missing: false },
        { name: "SPACE.md", path: "   ", content: "bad", missing: false },
      ] as unknown as WorkspaceBootstrapFile[];
    });
    const workspaceDir = await makeTempWorkspace("openclaw-bootstrap-synthetic-");
    const warnings: string[] = [];
    const files = await resolveBootstrapFilesForRun({
      workspaceDir,
      warn: (message) => warnings.push(message),
    });

    expect(files.map((f) => f.name)).not.toContain("UNDEFINED.md");
    expect(files.map((f) => f.name)).not.toContain("NULL.md");
    expect(files.map((f) => f.name)).not.toContain("NUMBER.md");
    expect(files.map((f) => f.name)).not.toContain("EMPTY.md");
    expect(files.map((f) => f.name)).not.toContain("SPACE.md");
    expect(warnings.filter((w) => w.includes('missing or invalid "path" field'))).toHaveLength(5);
  });

  it("TC-212-3-U-12: deduplicates identical synthetic paths on the literal string", async () => {
    registerInternalHook("agent:bootstrap", (event) => {
      const context = event.context as AgentBootstrapHookContext;
      context.bootstrapFiles = [
        ...context.bootstrapFiles,
        {
          name: "HEARTBEAT_DB.md",
          path: "db:AGENT/HEARTBEAT.md",
          content: "first",
          missing: false,
        },
        {
          name: "HEARTBEAT_DB.md",
          path: "db:AGENT/HEARTBEAT.md",
          content: "second",
          missing: false,
        },
      ] as unknown as WorkspaceBootstrapFile[];
    });
    const workspaceDir = await makeTempWorkspace("openclaw-bootstrap-synthetic-");
    const files = await resolveBootstrapFilesForRun({ workspaceDir });
    const heartbeats = files.filter((f) => f.path === "db:AGENT/HEARTBEAT.md");

    expect(heartbeats).toHaveLength(1);
    expect(heartbeats[0]?.content).toBe("first");
  });

  it("TC-212-3-U-13: does not collapse synthetic path and workspace-relative path with same-looking filename", async () => {
    registerInternalHook("agent:bootstrap", (event) => {
      const context = event.context as AgentBootstrapHookContext;
      context.bootstrapFiles = [
        ...context.bootstrapFiles,
        {
          name: "HEARTBEAT.md",
          path: "db:AGENT/HEARTBEAT.md",
          content: "db content",
          missing: false,
        },
        {
          name: "HEARTBEAT.md",
          path: path.join(context.workspaceDir, "HEARTBEAT.md"),
          content: "fs content",
          missing: false,
        },
      ] as unknown as WorkspaceBootstrapFile[];
    });

    const workspaceDir = await makeTempWorkspace("openclaw-bootstrap-synthetic-");
    await fs.writeFile(path.join(workspaceDir, "HEARTBEAT.md"), "fs content", "utf8");

    const files = await resolveBootstrapFilesForRun({ workspaceDir });
    const syntheticEntry = files.find((f) => f.path === "db:AGENT/HEARTBEAT.md");
    const fsEntry = files.find((f) => f.path === path.join(workspaceDir, "HEARTBEAT.md"));

    expect(syntheticEntry).toBeDefined();
    expect(fsEntry).toBeDefined();
  });

  it("TC-212-3-INT-01: real agent:bootstrap hook pipeline preserves synthetic path end-to-end", async () => {
    registerInternalHook("agent:bootstrap", (event) => {
      const context = event.context as AgentBootstrapHookContext;
      context.bootstrapFiles = [
        ...context.bootstrapFiles,
        {
          name: "SOUL_DB.md",
          path: "db:AGENT/SOUL.md",
          content: "synthetic soul",
          missing: false,
        },
      ] as unknown as WorkspaceBootstrapFile[];
    });

    const workspaceDir = await makeTempWorkspace("openclaw-bootstrap-synthetic-");
    const files = await resolveBootstrapFilesForRun({ workspaceDir });
    const synthetic = files.find((f) => f.path === "db:AGENT/SOUL.md");

    expect(synthetic).toBeDefined();
    expect(synthetic?.path).toBe("db:AGENT/SOUL.md");
    expect(synthetic?.content).toBe("synthetic soul");
  });
});

describe("resolveContextInjectionMode", () => {
  const config: OpenClawConfig = {
    agents: {
      defaults: { contextInjection: "never" },
      entries: { strict: { contextInjection: "always" }, worker: {} },
    },
  };
  it.each([
    [undefined, undefined, "always"],
    [config, "strict", "always"],
    [config, "worker", "never"],
  ] as const)("resolves injection mode for %s/%s", (cfg, agentId, expected) => {
    expect(resolveContextInjectionMode(cfg, agentId)).toBe(expected);
  });
});
