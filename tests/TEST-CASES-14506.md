# Test Cases for .gitignore Updates (Issue #14506)

These test cases verify the correct behavior of the .gitignore updates for SE workflow temporary files.

## Test Case 1: Verify new patterns are ignored

1.  Create temporary files matching the new patterns:
    - `tests/TEST-CASES-temp.md`
    - `tests/TEST-RESULTS-temp.md`
    - `IMPLEMENTATION-temp.md`
    - `temp-review.md`
2.  Run `git status` and verify that these files are listed as untracked.

## Test Case 2: Verify existing tracked file is untracked

1.  Ensure that `IMPLEMENTATION-ISSUE-4.md` exists in the repository.
2.  Run `git rm --cached IMPLEMENTATION-ISSUE-4.md`
3.  Run `git status` and verify that `IMPLEMENTATION-ISSUE-4.md` is listed as untracked.

## Test Case 3: Verify files in subdirectories are ignored

1.  Create a subdirectory `temp_dir`.
2.  Create files matching the patterns in the subdirectory:
    - `temp_dir/TEST-CASES-temp.md`
    - `temp_dir/TEST-RESULTS-temp.md`
    - `temp_dir/IMPLEMENTATION-temp.md`
    - `temp_dir/temp-review.md`
3.  Run `git status` and verify that these files are listed as untracked.

## Test Case 4: Verify that legitimate files are not ignored

1.  Create a file `test.txt` that does not match the ignore patterns.
2.  Run `git add test.txt`
3.  Run `git status` and verify that `test.txt` is listed as a change to be committed.

## Test Case 5: Verify the patterns are case-sensitive

1.  Create a file `implementation-temp.md` (lowercase 'i')
2.  Run `git status` and verify that `implementation-temp.md` is listed as untracked.
