# ADR-008: Configuration Hierarchy with Environment Override

## Date
2025-01-06

## Status
Accepted

## Tags
configuration, environment, deployment

## Issue
How do we manage configuration across development, testing, and production environments with appropriate defaults?

## Decision
Implement a three-tier configuration hierarchy: defaults → config file → environment variables, with environment variables having highest precedence.

## Gist
### Default Configuration
Given that most users want to start quickly,
When we provide sensible defaults in code,
Then the system works with minimal configuration.

### Config File Layer
Given that some deployments need complex configuration,
When we support JSON/YAML config files,
Then operators can version control their settings.

### Environment Override
Given that containers and cloud deployments use environment variables,
When we allow env vars to override any setting,
Then deployment is flexible across platforms.

## Constraints
- Must work in containers without mounted files
- Cannot require configuration for basic usage
- Must support secure credential passing
- Should validate configuration at startup

## Positions
### Position 1: Environment Variables Only
- All configuration via environment
- **Rejected**: Verbose for complex configurations

### Position 2: Config Files Only
- Require configuration file
- **Rejected**: Complicates container deployments

### Position 3: Hierarchical Override
- Defaults → File → Environment
- **Accepted**: Maximum flexibility

## Argument
The three-tier approach serves different use cases:
1. **Developers**: Run with defaults, override specific values
2. **Operators**: Use config files for complex setups
3. **Containers**: Override with environment variables

Example flow:
```typescript
const config = {
  ...defaultConfig,                    // Built-in defaults
  ...loadConfigFile('./config.json'), // Optional file
  ...loadFromEnv()                    // Environment overrides
};
```

This enables:
- `npm start` works immediately
- Production can use detailed config files
- Kubernetes can inject secrets via env vars

## Implications
- **Positive**: Works everywhere from laptop to cloud
- **Positive**: Secure credential management
- **Positive**: Progressive complexity
- **Negative**: Three places to check for settings
- **Negative**: Precedence rules must be documented

## Related
- [Validation Strategy (ADR-010)](./010-zod-schema-validation.md)
- [Error Handling (ADR-006)](./006-error-handling-philosophy.md)
- [Type Safety (ADR-005)](./005-type-safety-approach.md)

## Notes
The hierarchy has proven invaluable for deployment flexibility. Developers appreciate zero-config startup, while operations teams can manage complex deployments through environment variables. The validation at startup catches configuration errors early.