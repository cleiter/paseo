/**
 * Refcounting for the orbit ring's shared rotation, kept apart from the component so the one
 * invariant that matters is testable without mounting anything: the rotation runs while at
 * least one ring is mounted and at no other time. An unattended `withRepeat` keeps the UI
 * thread's frame loop awake forever, so a leaked subscriber is a battery bug rather than a
 * visual one — nothing on screen looks wrong.
 *
 * The driver is injected because starting the animation is a Reanimated call and stopping it
 * is a `cancelAnimation`; neither has any behavior worth exercising here.
 */
export interface OrbitClockDriver {
  start(): void;
  stop(): void;
}

export interface OrbitClock {
  acquire(): void;
  release(): void;
}

export function createOrbitClock(driver: OrbitClockDriver): OrbitClock {
  let subscribers = 0;

  return {
    acquire() {
      subscribers += 1;
      if (subscribers === 1) {
        driver.start();
      }
    },
    // Releasing at zero is ignored rather than allowed to go negative. A count below zero
    // silently swallows the next acquire, and the ring would then sit still with no error.
    release() {
      if (subscribers === 0) {
        return;
      }
      subscribers -= 1;
      if (subscribers === 0) {
        driver.stop();
      }
    },
  };
}
