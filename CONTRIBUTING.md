# Contributing to Linden Engine

First off, thank you for considering contributing to Linden Engine! It's people like you that make Linden Engine such a great tool.

## Code of Conduct

This project and everyone participating in it is governed by our Code of Conduct. By participating, you are expected to uphold this code. Please report unacceptable behavior to the project maintainers.

### Our Standards

- **Be respectful** - Treat everyone with respect and kindness
- **Be inclusive** - Welcome newcomers and help them learn
- **Be constructive** - Provide helpful feedback and suggestions
- **Be patient** - Remember we're all learning and growing

## How Can I Contribute?

### Reporting Bugs

Before creating bug reports, please check the issue list as you might find out that you don't need to create one. When you are creating a bug report, please include as many details as possible:

- **Use a clear and descriptive title**
- **Describe the exact steps to reproduce the problem**
- **Provide specific examples** to demonstrate the steps
- **Describe the behavior you observed** after following the steps
- **Explain which behavior you expected to see instead** and why
- **Include screenshots or animated GIFs** if possible
- **Include your environment details** (OS, Node version, etc.)

**Bug Report Template:**

```markdown
## Bug Description
A clear and concise description of what the bug is.

## Steps to Reproduce
1. Go to '...'
2. Click on '...'
3. Scroll down to '...'
4. See error

## Expected Behavior
What you expected to happen.

## Actual Behavior
What actually happened.

## Screenshots
If applicable, add screenshots to help explain your problem.

## Environment
- OS: [e.g., Windows 11]
- Node Version: [e.g., 18.16.0]
- Linden Engine Version: [e.g., 0.1.0]
- Browser (if web): [e.g., Chrome 120]

## Additional Context
Add any other context about the problem here.
```

### Suggesting Features

Feature requests are welcome! Before creating a feature request:

- **Check if the feature has already been suggested**
- **Provide a clear and detailed explanation** of the feature
- **Explain why this feature would be useful** to most users
- **Provide examples** of how the feature would work

**Feature Request Template:**

```markdown
## Feature Description
A clear and concise description of the feature.

## Problem it Solves
Explain the problem this feature would solve.

## Proposed Solution
Describe your proposed solution.

## Alternatives Considered
Describe any alternative solutions you've considered.

## Examples
Provide examples of how this feature would work.

## Additional Context
Add any other context, screenshots, or mockups about the feature here.
```

### Pull Requests

1. **Fork the repo** and create your branch from `main`
2. **Make your changes** following our coding standards
3. **Add tests** if you're adding functionality
4. **Update documentation** if you're changing APIs
5. **Ensure all tests pass**
6. **Submit a pull request**

## Development Workflow

### 1. Setup

```bash
# Fork the repo on GitHub
# Clone your fork
git clone https://github.com/YOUR_USERNAME/LindenEngine.git
cd LindenEngine

# Add upstream remote
git remote add upstream https://github.com/ORIGINAL_OWNER/LindenEngine.git

# Install dependencies
npm install
```

### 2. Create a Branch

```bash
# Update your fork
git checkout main
git pull upstream main

# Create a feature branch
git checkout -b feature/amazing-feature
```

Branch naming convention:
- `feature/` - New features
- `fix/` - Bug fixes
- `docs/` - Documentation changes
- `refactor/` - Code refactoring
- `test/` - Adding tests
- `chore/` - Maintenance tasks

### 3. Make Changes

- Write clean, readable code
- Follow the existing code style
- Add comments for complex logic
- Update documentation as needed

### 4. Test Your Changes

```bash
# Run the development server
npm run dev

# Build the project
npm run build

# Run tests (when available)
npm test
```

### 5. Commit Your Changes

Follow the [Conventional Commits](https://www.conventionalcommits.org/) specification:

```
type(scope): brief description

Longer description if needed...

Fixes #123
```

**Types:**
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation only changes
- `style`: Changes that don't affect code meaning (whitespace, formatting)
- `refactor`: Code change that neither fixes a bug nor adds a feature
- `perf`: Performance improvement
- `test`: Adding missing tests
- `chore`: Changes to build process or auxiliary tools

**Examples:**

```bash
git commit -m "feat(scripting): expose ctx.scene.findByTag to scripts"
git commit -m "fix(editor): resolve viewport rendering issue on Firefox"
git commit -m "docs(readme): update installation instructions"
```

### 6. Push and Create PR

```bash
# Push to your fork
git push origin feature/amazing-feature

# Go to GitHub and create a Pull Request
```

**Pull Request Template:**

```markdown
## Description
Brief description of what this PR does.

## Related Issue
Fixes #(issue number)

## Type of Change
- [ ] Bug fix (non-breaking change which fixes an issue)
- [ ] New feature (non-breaking change which adds functionality)
- [ ] Breaking change (fix or feature that would cause existing functionality to not work as expected)
- [ ] Documentation update

## How Has This Been Tested?
Describe the tests you ran to verify your changes.

## Checklist
- [ ] My code follows the style guidelines of this project
- [ ] I have performed a self-review of my own code
- [ ] I have commented my code, particularly in hard-to-understand areas
- [ ] I have made corresponding changes to the documentation
- [ ] My changes generate no new warnings
- [ ] I have added tests that prove my fix is effective or that my feature works
- [ ] New and existing unit tests pass locally with my changes

## Screenshots (if appropriate)
```

## Coding Standards

### TypeScript Guidelines

- Use **TypeScript** for all new code
- Provide **type annotations** for public APIs
- Avoid `any` - use proper types or `unknown`
- Use **interfaces** for object shapes
- Use **enums** for fixed sets of values

**Good:**

```typescript
interface PlayerStats {
  health: number
  maxHealth: number
  stamina: number
}

function healPlayer(player: Entity, amount: number): void {
  const stats = player.getComponent<PlayerStats>('Stats')
  if (stats) {
    stats.health = Math.min(stats.health + amount, stats.maxHealth)
  }
}
```

**Bad:**

```typescript
function healPlayer(player: any, amount: any) {
  player.health += amount
}
```

### Code Style

- **Indentation**: 2 spaces
- **Line length**: Max 100 characters
- **Semicolons**: Required
- **Quotes**: Single quotes for strings
- **Trailing commas**: Yes, in multi-line structures

Run Prettier to format your code:

```bash
npm run format
```

### Naming Conventions

| Type | Convention | Example |
|------|------------|---------|
| **Variables** | camelCase | `playerHealth`, `maxSpeed` |
| **Constants** | UPPER_SNAKE_CASE | `MAX_PLAYERS`, `DEFAULT_SPEED` |
| **Functions** | camelCase | `getPlayer()`, `updateHealth()` |
| **Classes** | PascalCase | `PlayerController`, `GameWorld` |
| **Interfaces** | PascalCase with `I` prefix | `IGameScript`, `IComponent` |
| **Types** | PascalCase | `PlayerStats`, `Vector3` |
| **Enums** | PascalCase | `NodeCategory`, `InputType` |
| **Files** | PascalCase | `PlayerController.ts`, `GameWorld.ts` |

### File Organization

```typescript
// 1. Imports (external first, then internal)
import { React, useState } from 'react'
import { nanoid } from 'nanoid'

import { Entity } from '@engine/ecs/Entity'
import { Component } from '@engine/ecs/Component'

// 2. Type definitions
interface Props {
  // ...
}

type State = {
  // ...
}

// 3. Constants
const DEFAULT_SPEED = 5

// 4. Main code
export class PlayerController {
  // ...
}

// 5. Helper functions (if any)
function calculateDistance(a: Vector3, b: Vector3): number {
  // ...
}
```

### Comments

- Use **JSDoc** for public APIs
- Add **inline comments** for complex logic
- Keep comments **up-to-date** with code changes

```typescript
/**
 * Calculates the distance between two 3D points
 * 
 * @param a - First point
 * @param b - Second point
 * @returns Distance between points
 * 
 * @example
 * ```typescript
 * const dist = calculateDistance(
 *   { x: 0, y: 0, z: 0 },
 *   { x: 3, y: 4, z: 0 }
 * ) // Returns 5
 * ```
 */
export function calculateDistance(a: Vector3, b: Vector3): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const dz = b.z - a.z
  return Math.sqrt(dx * dx + dy * dy + dz * dz)
}
```

## Documentation

### Code Documentation

- Document all **public APIs**
- Provide **usage examples** in JSDoc
- Keep **inline comments** concise
- Update docs when changing code

### Markdown Documentation

- Use **clear headings** for organization
- Include **code examples** with syntax highlighting
- Add **screenshots** for visual features
- Provide **step-by-step instructions**

## Testing

Currently, Linden Engine is building its test infrastructure. When adding new features:

1. **Manual Testing**
   - Test in both web and desktop modes
   - Test on different browsers (Chrome, Firefox, Safari)
   - Test on different OS (Windows, macOS, Linux)

2. **Future: Unit Tests**
   ```typescript
   describe('Vector3Utils', () => {
     test('should calculate distance correctly', () => {
       const a = { x: 0, y: 0, z: 0 }
       const b = { x: 3, y: 4, z: 0 }
       expect(Vector3Utils.distance(a, b)).toBe(5)
     })
   })
   ```

## Project Structure

When adding new code, place it in the appropriate directory:

```
LindenEngine/
├── editor/              # UI components
│   ├── ui/             # Buttons, toolbars, etc.
│   ├── panels/         # Editor panels
│   └── viewport/       # 3D viewport
├── engine/             # Core engine
│   ├── core/          # Engine lifecycle
│   ├── ecs/           # Entity Component System
│   ├── renderer/      # Graphics
│   └── utils/         # Utilities
└── docs/              # Documentation
```

## Review Process

1. **Automated Checks**
   - Code builds successfully
   - No linting errors
   - No TypeScript errors

2. **Manual Review**
   - Code quality and readability
   - Follows project conventions
   - Appropriate test coverage
   - Documentation is updated

3. **Approval**
   - At least one maintainer approval required
   - All feedback addressed
   - CI checks pass

## Community

- **Be patient** - Reviews may take a few days
- **Be open to feedback** - It helps us all improve
- **Ask questions** - We're here to help!
- **Share your work** - Show off what you've built!

## Recognition

Contributors will be:
- Added to the **Contributors list**
- Mentioned in **release notes** for significant contributions
- Credited in **documentation** for major features

## Questions?

Feel free to:
- Open a **GitHub Discussion**
- Ask in **Discord** (coming soon)
- Email the maintainers

---

**Thank you for contributing to Linden Engine!** 🎉

Every contribution, no matter how small, makes a difference. We appreciate your time and effort in making Linden Engine better for everyone.
