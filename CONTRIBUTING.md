# Contributing to CollarAgent

Thank you for contributing to CollarAgent! This document outlines our development workflow, coding standards, and submission guidelines.

---

## 1. Development Setup

### Prerequisites

- **Node.js**: >= 22.0.0
- **Yarn**: >= 1.22.0

### Initial Setup

```bash
# Clone the repository
git clone https://github.com/Goldwaterfung/Collaragent.git
cd Collaragent

# Copy environment variables template
cp .env.example .env

# Install dependencies and initialize Git hooks
yarn install
```

---

## 2. Git Workflow & Commit Conventions

### Branch Strategy

- Main branch: `main`
- Feature branches: `feat/<feature-name>`
- Bugfix branches: `fix/<issue-description>`
- Maintenance branches: `chore/<task-name>`

### Commit Messages (Conventional Commits)

This repository enforces [Conventional Commits](https://www.conventionalcommits.org/) via Commitlint and Husky hooks.

Format:

```text
<type>(<optional scope>): <description>
```

#### Allowed Types:

- `feat`: A new feature
- `fix`: A bug fix
- `docs`: Documentation changes
- `style`: Code styling or formatting
- `refactor`: Code refactoring without changing functionality
- `perf`: Performance improvements
- `test`: Adding or modifying tests
- `build`: Build system or dependency changes
- `ci`: CI/CD pipeline changes
- `chore`: Other changes that don't modify src or test files
- `revert`: Reverts a previous commit

#### Example:

```bash
git commit -m "feat(editor): add support for equation insertion"
git commit -m "fix(sync): resolve race condition in websocket connection pool"
```

---

## 3. Code Standards & Quality Gates

All contributions must adhere to the rules defined in `.agents/rules/coding-rules.md`:

1. **Zero `any` Policy**: Do not use `any`, `as any`, or `<any>`. Use strict narrowing, discriminated unions, or `unknown` with runtime validation (Zod).
2. **No Suppression Comments**: Do not use `@ts-ignore` or `@ts-nocheck`.
3. **Structured Errors**: Use domain error classes with typed error codes. Preserve upstream errors in the `.cause` chain.
4. **Clean Diagnostics**: Do not commit `console.log` statements containing raw payload tokens or sensitive keys.

### Local Verification Commands

Before submitting a pull request, ensure all local checks pass:

```bash
# Typecheck
yarn typecheck

# Unit Tests
yarn vitest run

# Formatting check
yarn format:check

# Auto-format
yarn format:fix
```

---

## 4. Submitting Pull Requests

1. Push your branch to GitHub.
2. Open a Pull Request against `main`.
3. Complete the Pull Request template checklist.
4. Ensure the GitHub Actions CI quality gate passes.
