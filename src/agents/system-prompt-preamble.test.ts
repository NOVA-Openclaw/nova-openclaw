import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_SYSTEM_PROMPT_PREAMBLE,
  clearSystemPromptPreambleCache,
  resolveSystemPromptPreamble,
} from "./system-prompt-preamble.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "preamble-test-"));
}

function writePreamble(
  dir: string,
  content: string,
  filename = "system-prompt-preamble.md",
): string {
  const filePath = path.join(dir, filename);
  fs.writeFileSync(filePath, content, "utf8");
  return filePath;
}

function makeEnv(stateDir: string): NodeJS.ProcessEnv {
  return { ...process.env, OPENCLAW_STATE_DIR: stateDir };
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

let tmpDir: string;

beforeEach(() => {
  tmpDir = makeTempDir();
  clearSystemPromptPreambleCache();
});

afterEach(() => {
  clearSystemPromptPreambleCache();
  // Restore file permissions in case TC-61-15 left files unreadable.
  try {
    fs.readdirSync(tmpDir).forEach((f) => {
      try {
        fs.chmodSync(path.join(tmpDir, f), 0o644);
      } catch {
        // ignore
      }
    });
  } catch {
    // ignore if dir doesn't exist
  }
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

// ---------------------------------------------------------------------------
// Group 1 — Happy Path
// ---------------------------------------------------------------------------

describe("TC-61-01: custom preamble replaces default (resolveSystemPromptPreamble)", () => {
  it("returns custom preamble content when file exists", () => {
    writePreamble(tmpDir, "You are Aria, a test agent.");
    const result = resolveSystemPromptPreamble({ env: makeEnv(tmpDir) });
    expect(result).toBe("You are Aria, a test agent.");
    expect(result).not.toContain(DEFAULT_SYSTEM_PROMPT_PREAMBLE);
  });
});

describe("TC-61-04: preamble with trailing newline is trimmed", () => {
  it("trims trailing newline from file content", () => {
    writePreamble(tmpDir, "You are Aria.\n");
    const result = resolveSystemPromptPreamble({ env: makeEnv(tmpDir) });
    expect(result).toBe("You are Aria.");
  });
});

describe("TC-61-05: preamble with embedded newlines preserved", () => {
  it("preserves internal newlines in multi-line preamble", () => {
    const content =
      "You are Aria, a specialized research agent.\nYour purpose is to assist with information retrieval.";
    writePreamble(tmpDir, content);
    const result = resolveSystemPromptPreamble({ env: makeEnv(tmpDir) });
    expect(result).toBe(content);
  });
});

// ---------------------------------------------------------------------------
// Group 2 — Default Fallback
// ---------------------------------------------------------------------------

describe("TC-61-06 / TC-61-07 / TC-61-08: no preamble file returns default", () => {
  it("returns DEFAULT_SYSTEM_PROMPT_PREAMBLE when file is absent", () => {
    // tmpDir has no preamble file
    const result = resolveSystemPromptPreamble({ env: makeEnv(tmpDir) });
    expect(result).toBe(DEFAULT_SYSTEM_PROMPT_PREAMBLE);
    expect(result).toBe("You are a personal assistant running inside OpenClaw.");
  });
});

// ---------------------------------------------------------------------------
// Group 3 — Edge Cases
// ---------------------------------------------------------------------------

describe("TC-61-09: empty preamble file falls back to default", () => {
  it("returns default when file is empty", () => {
    writePreamble(tmpDir, "");
    const result = resolveSystemPromptPreamble({ env: makeEnv(tmpDir) });
    expect(result).toBe(DEFAULT_SYSTEM_PROMPT_PREAMBLE);
  });
});

describe("TC-61-10: whitespace-only preamble file falls back to default", () => {
  it("returns default for whitespace-only content", () => {
    writePreamble(tmpDir, "   \n\t\n  ");
    const result = resolveSystemPromptPreamble({ env: makeEnv(tmpDir) });
    expect(result).toBe(DEFAULT_SYSTEM_PROMPT_PREAMBLE);
    expect(/^\s/.test(result)).toBe(false);
  });
});

describe("TC-61-11: very large preamble file does not crash", () => {
  it("handles 150 KB preamble file", () => {
    const paragraph = "You are a custom agent. " + "A".repeat(99);
    const content = (paragraph + "\n").repeat(1500); // ~150 KB
    writePreamble(tmpDir, content);
    const result = resolveSystemPromptPreamble({ env: makeEnv(tmpDir) });
    expect(result).toBeTruthy();
    expect(result.startsWith("You are a custom agent.")).toBe(true);
  });
});

describe("TC-61-12: special characters preserved", () => {
  it("preserves quotes, backticks, and angle brackets", () => {
    const content = 'You are "Aria" — the agent. Use <tools> and `code blocks` freely.';
    writePreamble(tmpDir, content);
    const result = resolveSystemPromptPreamble({ env: makeEnv(tmpDir) });
    expect(result).toContain('You are "Aria"');
    expect(result).toContain("<tools>");
  });
});

describe("TC-61-13: Unicode content preserved", () => {
  it("preserves Unicode characters", () => {
    const content = "You are 芳子, an assistant. 日本語で答えます。";
    writePreamble(tmpDir, content);
    const result = resolveSystemPromptPreamble({ env: makeEnv(tmpDir) });
    expect(result).toContain("芳子");
    expect(result).toContain("日本語");
  });
});

describe("TC-61-14: CRLF line endings normalised to LF", () => {
  it("removes carriage returns from CRLF content", () => {
    writePreamble(tmpDir, "You are Aria.\r\nSecond line.\r\n");
    const result = resolveSystemPromptPreamble({ env: makeEnv(tmpDir) });
    expect(result).not.toContain("\r");
    expect(result).toContain("You are Aria.");
    expect(result).toContain("Second line.");
  });
});

describe("TC-61-15: unreadable file falls back to default without throwing", () => {
  it("returns default and does not throw on permission error", () => {
    const filePath = writePreamble(tmpDir, "You are Aria.");
    // Make file unreadable — skip on root (CI may run as root).
    const isRoot = process.getuid?.() === 0;
    if (isRoot) {
      // Root can read any file, so just verify no-throw with readable file.
      const result = resolveSystemPromptPreamble({ env: makeEnv(tmpDir) });
      expect(result).toBe("You are Aria.");
      return;
    }
    fs.chmodSync(filePath, 0o000);
    let result: string | undefined;
    expect(() => {
      result = resolveSystemPromptPreamble({ env: makeEnv(tmpDir) });
    }).not.toThrow();
    expect(result).toBe(DEFAULT_SYSTEM_PROMPT_PREAMBLE);
    // Restore for cleanup.
    fs.chmodSync(filePath, 0o644);
  });
});

describe("TC-61-16: state directory does not exist", () => {
  it("returns default when state dir is missing", () => {
    const nonExistentDir = path.join(os.tmpdir(), `preamble-nonexistent-${Date.now()}`);
    const result = resolveSystemPromptPreamble({ env: makeEnv(nonExistentDir) });
    expect(result).toBe(DEFAULT_SYSTEM_PROMPT_PREAMBLE);
  });
});

// ---------------------------------------------------------------------------
// Group 4 — Cache Behaviour
// ---------------------------------------------------------------------------

describe("TC-61-17: result is cached after first read", () => {
  it("reads file only once on repeated calls", () => {
    writePreamble(tmpDir, "You are Aria.");
    const readFileSyncSpy = vi.spyOn(fs, "readFileSync");

    const env = makeEnv(tmpDir);
    const first = resolveSystemPromptPreamble({ env });
    // Modify file on disk.
    writePreamble(tmpDir, "You are Bob.");
    const second = resolveSystemPromptPreamble({ env });

    expect(readFileSyncSpy).toHaveBeenCalledTimes(1);
    expect(first).toBe("You are Aria.");
    expect(second).toBe("You are Aria.");

    readFileSyncSpy.mockRestore();
  });
});

describe("TC-61-19: preamble cache cleared on clearSystemPromptPreambleCache", () => {
  it("re-reads file after cache is cleared", () => {
    const env = makeEnv(tmpDir);
    writePreamble(tmpDir, "You are Aria.");
    const first = resolveSystemPromptPreamble({ env });
    expect(first).toBe("You are Aria.");

    clearSystemPromptPreambleCache();

    writePreamble(tmpDir, "You are Bob.");
    const second = resolveSystemPromptPreamble({ env });
    expect(second).toBe("You are Bob.");
  });
});

// ---------------------------------------------------------------------------
// Group 7 — OPENCLAW_STATE_DIR override
// ---------------------------------------------------------------------------

describe("TC-61-26: reads from OPENCLAW_STATE_DIR location", () => {
  it("reads preamble from custom state dir env var", () => {
    writePreamble(tmpDir, "You are StateDir Agent.");
    const result = resolveSystemPromptPreamble({ env: makeEnv(tmpDir) });
    expect(result).toBe("You are StateDir Agent.");
  });
});

// ---------------------------------------------------------------------------
// Group 8 — Filename override via preambleFile option
// ---------------------------------------------------------------------------

describe("TC-61-27: custom filename option overrides default filename", () => {
  it("reads from custom filename when provided", () => {
    writePreamble(tmpDir, "You are CustomFile Agent.", "my-custom-preamble.md");
    // Also write the default file with different content to confirm it is NOT read.
    writePreamble(tmpDir, "You are Default Agent.");
    const result = resolveSystemPromptPreamble({
      env: makeEnv(tmpDir),
      preambleFile: "my-custom-preamble.md",
    });
    expect(result).toBe("You are CustomFile Agent.");
  });
});

describe("TC-61-28: custom filename set but file doesn't exist → falls back to default string", () => {
  it("returns default when custom-named file is absent", () => {
    // Neither the custom file nor system-prompt-preamble.md exist.
    const result = resolveSystemPromptPreamble({
      env: makeEnv(tmpDir),
      preambleFile: "nonexistent-preamble.md",
    });
    expect(result).toBe(DEFAULT_SYSTEM_PROMPT_PREAMBLE);
  });
});

describe("TC-61-29: no filename option → reads default filename", () => {
  it("reads system-prompt-preamble.md when no preambleFile option", () => {
    writePreamble(tmpDir, "You are Default Filename Agent.");
    const result = resolveSystemPromptPreamble({ env: makeEnv(tmpDir) });
    expect(result).toBe("You are Default Filename Agent.");
  });
});
