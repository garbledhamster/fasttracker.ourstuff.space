# Code Quality Tools

This project uses several code quality tools to ensure consistent code style, catch bugs early, and maintain high code quality standards.

## Tools Installed

### 1. Biome
**Purpose**: Format + lint HTML/CSS/JS  
**When to run**: Before every commit  
**What it does**: Enforces consistent code style and catches basic bugs

```bash
# Run formatting and linting together (recommended)
npm run biome

# Format code only
npm run biome:format

# Lint code only
npm run biome:lint

# Check and auto-fix issues
npm run biome:check
```

### 2. html-validate
**Purpose**: Validate HTML structure  
**When to run**: After editing pages/layouts  
**What it does**: Prevents invalid markup and accessibility issues

```bash
npm run html-validate
```

### 3. Nu Html Checker (vnu)
**Purpose**: Standards compliance validation  
**When to run**: Before major releases  
**What it does**: Ensures spec-correct and cross-browser HTML

```bash
npm run vnu
```

### 4. Stylelint
**Purpose**: CSS quality enforcement  
**When to run**: After styling changes  
**What it does**: Catches invalid properties and bad patterns

```bash
# Check CSS
npm run stylelint

# Auto-fix CSS issues
npm run stylelint:fix
```

### 5. ESLint
**Purpose**: JavaScript logic analysis  
**When to run**: After script changes  
**What it does**: Prevents runtime errors and unsafe code

```bash
# Check JavaScript
npm run eslint

# Auto-fix JavaScript issues
npm run eslint:fix
```

## Recommended Workflow

### Before Every Commit
Run Biome to format and lint your code:
```bash
npm run biome
```

### After Making Changes
Run the appropriate tool based on what you changed:
- HTML changes: `npm run html-validate`
- CSS changes: `npm run stylelint`
- JavaScript changes: `npm run eslint`

### All-in-One Commands

#### Format all code
```bash
npm run format
```
This runs:
- Biome format
- Stylelint fix
- ESLint fix

#### Lint all code
```bash
npm run lint
```
This runs:
- Biome lint
- html-validate
- Stylelint
- ESLint

#### Complete check (format + lint + validate)
```bash
npm run check
```
This runs all formatters, linters, and the Nu Html Checker.

## Setup Instructions

1. **Install Node.js** (if not already installed): https://nodejs.org/

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Run your first check**:
   ```bash
   npm run check
   ```

## Configuration Files

Each tool has its own configuration file:

- **Biome**: `biome.json`
- **html-validate**: `.htmlvalidate.json`
- **Stylelint**: `.stylelintrc.json`
- **ESLint**: `eslint.config.js`

You can customize these files to adjust rules and settings according to your project's needs.

## Pre-commit Hook (Optional)

To automatically run Biome before every commit, you can set up a Git pre-commit hook:

1. Create the hook file:
   ```bash
   mkdir -p .git/hooks
   cat > .git/hooks/pre-commit << 'EOF'
#!/bin/sh
# Run Biome check before commit
npm run biome
if [ $? -ne 0 ]; then
  echo "Biome check failed. Please fix the issues and try again."
  exit 1
fi
EOF
   chmod +x .git/hooks/pre-commit
   ```

2. Now Biome will automatically run before every commit!

## Troubleshooting

### "npm: command not found"
Install Node.js from https://nodejs.org/

### "Module not found" errors
Run `npm install` to install all dependencies.

### Java errors when running vnu
The Nu Html Checker requires Java to be installed. Install Java from:
- https://www.oracle.com/java/technologies/downloads/
- Or use OpenJDK: https://openjdk.org/

### Linting errors are overwhelming
Start by running auto-fix commands:
```bash
npm run format
```
This will automatically fix many common issues.

## Need Help?

- Check the official documentation for each tool:
  - [Biome](https://biomejs.dev/)
  - [html-validate](https://html-validate.org/)
  - [Nu Html Checker](https://validator.github.io/validator/)
  - [Stylelint](https://stylelint.io/)
  - [ESLint](https://eslint.org/)
