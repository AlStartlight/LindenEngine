// Geogram's initialize() mounts the host filesystem (NODEFS: cwd and '/') into the module when it sees
// Node. A geometry module needs no host files, so take the branch it skips when NODERAWFS is defined.
// (In Emscripten's own code NODERAWFS is a link-time setting, so this runtime variable changes nothing else.)
var NODERAWFS = true;
