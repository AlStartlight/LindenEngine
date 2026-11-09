/**
 * Optional agent features.
 *
 * img2threejs (a third-party skill, resources/agent-skills/img2threejs) is OFF: the agent rebuilds
 * objects from reference images with Linden's own tools (prompt section 7). The packaged app does
 * not ship the skill. LINDEN_IMG2THREEJS=1 turns it back on in a dev checkout (and in its E2E test).
 */
export function img2threejsEnabled(): boolean {
  return process.env.LINDEN_IMG2THREEJS === '1'
}
