When repository exploration is required:

- Invoke:
  opencode run --model openai/gpt-5.4-mini "$PROMPT"

- Ask it to:
  - Find only the relevant files.
  - List relevant symbols/functions.
  - Return at most 10 file paths.
  - Do not explain the entire codebase.
  - Do not output file contents unless requested.

Use the returned summary as the basis for further work.