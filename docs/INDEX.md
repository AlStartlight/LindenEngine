# Linden Engine - Documentation Index

## 📖 Quick Navigation

### Getting Started
- **[QUICK_START.md](../QUICK_START.md)** - Setup & first steps
- **[README.md](../README.md)** - Project overview

### Feature Overview
- **[FEATURE_SUMMARY.md](../FEATURE_SUMMARY.md)** - Complete feature list

### Deep Dive Documentation

#### Architecture & Design
- **[ARCHITECTURE.md](./ARCHITECTURE.md)**
  - System architecture diagram
  - Engine update loop
  - ECS design patterns
  - Rendering pipeline
  - Data flow
  - Plugin architecture
  - Memory management
  - Performance optimization

#### API Reference
- **[API.md](./API.md)**
  - Engine API
  - ECS classes (Entity, Component, World, System)
  - Rendering (Camera, Light, MeshRenderer)
  - Physics (RigidBody, Collider)
  - Scripting (IGameScript, ScriptComponent)
  - Utilities (Vector3Utils, Logger, PerformanceMonitor)
  - Events system
  - Code examples

#### Best Practices
- **[BEST_PRACTICES.md](./BEST_PRACTICES.md)**
  - Design patterns
    - Component usage
    - System queries
    - Event-driven architecture
  - Performance optimization
    - Object pooling
    - Spatial partitioning
    - Level of Detail (LOD)
    - Frustum culling
    - Dirty flag pattern
  - Memory management
    - Memory monitoring
    - Asset caching
  - Code organization
    - Module structure
    - Dependency injection
    - Lazy loading
  - Testing
  - Code style guidelines
  - Deployment

#### Plugin Development
- **[PLUGIN_DEVELOPMENT.md](./PLUGIN_DEVELOPMENT.md)**
  - Plugin interface
  - Creating plugins
  - Plugin configuration
  - Loading plugins
  - Hot reload
  - Example plugins
  - Building & publishing
  - Best practices
  - Debugging

## 🎯 By Topic

### Game Development
1. Start with [QUICK_START.md](../QUICK_START.md)
2. Create first entity in [API.md](./API.md#complete-game-world-setup)
3. Write script in [API.md](./API.md#creating-custom-script)
4. Optimize with [BEST_PRACTICES.md](./BEST_PRACTICES.md)

### Performance Optimization
1. Read [ARCHITECTURE.md](./ARCHITECTURE.md#-performance-optimization-strategies)
2. Study [BEST_PRACTICES.md](./BEST_PRACTICES.md#-performance-optimization)
3. Monitor with [API.md](./API.md#performance-monitoring)

### System Design
1. Understand [ARCHITECTURE.md](./ARCHITECTURE.md#-system-architecture)
2. Learn ECS in [ARCHITECTURE.md](./ARCHITECTURE.md#-ecs-entity-component-system-design)
3. Check examples in [API.md](./API.md)

### Plugin Development
1. Read [PLUGIN_DEVELOPMENT.md](./PLUGIN_DEVELOPMENT.md)
2. Study examples in same file
3. Review lifecycle in [ARCHITECTURE.md](./ARCHITECTURE.md)

### Rendering
1. Learn pipeline in [ARCHITECTURE.md](./ARCHITECTURE.md#-rendering-pipeline)
2. Reference API in [API.md](./API.md#rendering)
3. Optimize in [BEST_PRACTICES.md](./BEST_PRACTICES.md#-performance-optimization)

### Physics
1. Review physics system in [ARCHITECTURE.md](./ARCHITECTURE.md)
2. API reference in [API.md](./API.md#physics)
3. Performance tips in [BEST_PRACTICES.md](./BEST_PRACTICES.md)

### Scripting
1. Lifecycle in [ARCHITECTURE.md](./ARCHITECTURE.md#-script-lifecycle)
2. Implementation in [API.md](./API.md#creating-custom-script)
3. Hot-reload in [BEST_PRACTICES.md](./BEST_PRACTICES.md)

## 📚 Documentation Structure

```
docs/
├── ARCHITECTURE.md        # System design & diagrams
├── API.md                # Complete API reference
├── BEST_PRACTICES.md     # Patterns & optimization
├── PLUGIN_DEVELOPMENT.md # Plugin creation
└── INDEX.md              # This file

../
├── README.md             # Main project overview
├── QUICK_START.md        # Getting started guide
├── FEATURE_SUMMARY.md    # Feature checklist
└── package.json          # Project dependencies
```

## 🔍 Quick Lookup

### I want to...

**Create an entity**
- See [API.md - Entity Management](./API.md#entity-api)
- Example in [QUICK_START.md - First Game Object](../QUICK_START.md#1-membuat-first-game-object)

**Write a script**
- See [API.md - Creating Custom Script](./API.md#creating-custom-script)
- Lifecycle in [ARCHITECTURE.md - Script Lifecycle](./ARCHITECTURE.md#-script-lifecycle)

**Create a system**
- See [API.md - Creating Custom System](./API.md#creating-custom-system)
- Design in [ARCHITECTURE.md - System Architecture](./ARCHITECTURE.md)

**Optimize performance**
- See [BEST_PRACTICES.md - Performance Optimization](./BEST_PRACTICES.md#-performance-optimization)
- Strategies in [ARCHITECTURE.md - Performance](./ARCHITECTURE.md#-performance-optimization-strategies)

**Create a plugin**
- See [PLUGIN_DEVELOPMENT.md](./PLUGIN_DEVELOPMENT.md)
- Examples in same document

**Debug issues**
- Check [QUICK_START.md - Debugging Tips](../QUICK_START.md#debugging-tips)
- Review [ARCHITECTURE.md - Debugging Architecture](./ARCHITECTURE.md#-debugging-architecture)

**Profile performance**
- See [API.md - Performance Monitoring](./API.md#performance-monitoring)
- Learn patterns in [BEST_PRACTICES.md - Memory Monitoring](./BEST_PRACTICES.md#1-memory-monitoring)

**Build for production**
- See [QUICK_START.md - Build & Deployment](../QUICK_START.md#build--deployment)
- Optimization in [BEST_PRACTICES.md - Deployment](./BEST_PRACTICES.md#-deployment)

## 📖 Learning Resources

### For Beginners
1. [QUICK_START.md](../QUICK_START.md) - 10 minutes
2. [FEATURE_SUMMARY.md](../FEATURE_SUMMARY.md) - 15 minutes
3. [API.md - Examples](./API.md#examples) - 20 minutes

### For Intermediate Developers
1. [ARCHITECTURE.md](./ARCHITECTURE.md) - 30 minutes
2. [BEST_PRACTICES.md](./BEST_PRACTICES.md) - Design patterns - 20 minutes
3. [API.md](./API.md) - Full reference - 30 minutes

### For Advanced Users
1. [ARCHITECTURE.md - Deep dive](./ARCHITECTURE.md) - Performance & memory
2. [BEST_PRACTICES.md - Advanced](./BEST_PRACTICES.md) - Optimization techniques
3. [PLUGIN_DEVELOPMENT.md](./PLUGIN_DEVELOPMENT.md) - Extension system

## 🎓 Tutorial Progression

### Level 1: Essentials (1 hour)
- [ ] Read QUICK_START.md
- [ ] Setup development environment
- [ ] Create first scene
- [ ] Add entity with components
- [ ] Test in editor

### Level 2: Fundamentals (2 hours)
- [ ] Read ARCHITECTURE.md
- [ ] Create custom script
- [ ] Implement physics
- [ ] Create custom system
- [ ] Monitor performance

### Level 3: Intermediate (4 hours)
- [ ] Read API.md
- [ ] Create advanced game mechanics
- [ ] Optimize rendering
- [ ] Implement LOD system
- [ ] Setup asset pipeline

### Level 4: Advanced (8+ hours)
- [ ] Read BEST_PRACTICES.md
- [ ] Create plugin
- [ ] Profile & optimize
- [ ] Build complete project
- [ ] Deploy to production

## 🔗 Cross-References

### ECS Pattern
- Definition: [ARCHITECTURE.md - ECS Design](./ARCHITECTURE.md#-ecs-entity-component-system-design)
- Implementation: [API.md - Entity Component System](./API.md#entity-component-system-ecs)
- Usage: [QUICK_START.md - Adding Components](../QUICK_START.md#adding-components)
- Best practices: [BEST_PRACTICES.md - Component Usage](./BEST_PRACTICES.md#1-proper-component-usage)

### Performance Optimization
- Overview: [ARCHITECTURE.md - Performance](./ARCHITECTURE.md#-performance-optimization-strategies)
- Techniques: [BEST_PRACTICES.md - Performance](./BEST_PRACTICES.md#-performance-optimization)
- API: [API.md - Performance Monitoring](./API.md#performance-monitoring)

### Hot Reload
- Architecture: [ARCHITECTURE.md - Plugin System](./ARCHITECTURE.md#-plugin-system-architecture)
- Implementation: [PLUGIN_DEVELOPMENT.md - Hot Reload](./PLUGIN_DEVELOPMENT.md#hot-reload)
- API: [API.md - ScriptComponent](./API.md#scriptcomponent-class)

## 🆘 Troubleshooting

### Issue: WebGPU not available
- Solution: See [QUICK_START.md - Troubleshooting](../QUICK_START.md#troubleshooting)
- Details: [API.md - Renderer](./API.md#renderer-class)

### Issue: Scripts not hot-reloading
- Solution: [QUICK_START.md - Scripts Not Reloading](../QUICK_START.md#scripts-not-reloading)
- Details: [ARCHITECTURE.md - Script Lifecycle](./ARCHITECTURE.md#-script-lifecycle)

### Issue: Low FPS
- Solution: [QUICK_START.md - Low FPS](../QUICK_START.md#low-fps)
- Details: [BEST_PRACTICES.md - Performance](./BEST_PRACTICES.md#-performance-optimization)

### Issue: Memory leak
- Solution: [BEST_PRACTICES.md - Memory Management](./BEST_PRACTICES.md#-memory-management)
- Details: [ARCHITECTURE.md - Memory Management](./ARCHITECTURE.md#-memory-management)

## 📞 Getting Help

1. **Check Documentation**
   - Search in this INDEX
   - Read relevant document
   - Check API examples

2. **Console Debugging**
   - Enable logging
   - Check console output
   - Review logs in Console Panel

3. **Performance Profiling**
   - Use PerformanceMonitor
   - Check frame timing
   - Review bottlenecks

4. **Community**
   - GitHub Issues
   - Discussions
   - Discord server

## ✅ Documentation Checklist

- [x] Architecture guide with diagrams
- [x] Complete API reference
- [x] Best practices & patterns
- [x] Plugin development guide
- [x] Quick start guide
- [x] Feature summary
- [x] Code examples
- [x] Troubleshooting
- [x] Learning progression
- [x] Cross-references

**All documentation is up-to-date and comprehensive!**
