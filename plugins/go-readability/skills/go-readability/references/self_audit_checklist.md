# Self-Audit Checklist for Go Code

Mechanical greps to catch the most common Go style violations BEFORE submitting code for review. Run from the repository root or the modified package directory. False positives are expected — these are starting points for inspection, not auto-rejection.

For each match: review against the corresponding section in `SKILL.md` and the linked [Google Go Style Decisions](https://google.github.io/styleguide/go/decisions).

## Strings & format verbs

```bash
# 1. Manually-quoted format verbs (should be %q, not '%s' / "%s")
#    See decisions#use-percent-q
grep -nE "['\"]%[svqd]['\"]" *.go
```

## Errors

```bash
# 2. Capitalized error strings (allowed only when starting with an exported
#    Go identifier, proper noun, or acronym -- inspect each match).
#    See decisions#error-strings
grep -nE 'fmt\.Errorf\("[A-Z]' *.go
grep -nE 'errors\.New\("[A-Z]' *.go

# 3. Error strings ending in punctuation
#    See decisions#error-strings
grep -nE 'fmt\.Errorf\(".*[.!?]"' *.go
```

## Test failure messages

```bash
# 4. Test failures missing the function-under-test name
#    See decisions#identify-the-function
grep -nE 't\.(Error|Fatal)f?\("(got|expected) ' *_test.go

# 5. Test failures with empty parens (missing inputs)
#    See decisions#identify-the-input
grep -nE 't\.(Error|Fatal)f?\("[A-Za-z_]+\(\)' *_test.go
```

## Naming

```bash
# 6. Get-prefixed methods (review each: plain accessor -> drop prefix;
#    remote call -> use Fetch; CPU-heavy -> use Compute).
#    See decisions#getters
grep -nE 'func .*\) Get[A-Z]' *.go

# 7. Receiver names longer than 2 letters (style: 1-2 letters,
#    abbreviation of the type, applied consistently).
#    See decisions#receiver-names
grep -nE 'func \([a-zA-Z]{3,} \*?[A-Z]' *.go
```

## Control flow

```bash
# 8. else { return } anti-pattern (line-of-sight violation).
#    See decisions#indent-error-flow
grep -nE '} else \{$' *.go

# 9. Bare break inside switch (redundant in Go).
#    See decisions#switch-break
grep -nB2 -E '^\s+break$' *.go | grep -B1 -A1 case
```

## Language

```bash
# 10. interface{} (use any instead, Go 1.18+).
#     See decisions#use-any
grep -nE '\binterface\{\}' *.go

# 11. context.Background() outside of main / init / TestXXX.
#     See decisions#contexts
grep -nE 'context\.Background\(\)' *.go | grep -vE '_test\.go|main\.go|init\.go'

# 12. Empty slice declaration as []T{} (prefer `var s []T`).
#     See decisions#nil-slices
grep -nE ':= \[\][a-zA-Z*]+\{\}' *.go
```

## Pre-Review Workflow

After inspecting with greps, run standard Go formatting, linting, and tests:

```bash
gofmt -s -w .       # standard formatting
go vet ./...        # static analysis checks
golangci-lint run   # comprehensive linter pass
go test -race ./... # test suite with race detector
```
