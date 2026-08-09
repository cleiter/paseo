import { describe, expect, test } from "vitest";
import { createOrbitClock, type OrbitClockDriver } from "./orbit-status-ring-clock";

function createRecordingDriver(): OrbitClockDriver & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    start() {
      calls.push("start");
    },
    stop() {
      calls.push("stop");
    },
  };
}

describe("orbit status ring clock", () => {
  test("starts the rotation once no matter how many rings mount", () => {
    const driver = createRecordingDriver();
    const clock = createOrbitClock(driver);

    clock.acquire();
    clock.acquire();
    clock.acquire();

    expect(driver.calls).toEqual(["start"]);
  });

  test("keeps rotating until the last ring unmounts", () => {
    const driver = createRecordingDriver();
    const clock = createOrbitClock(driver);
    clock.acquire();
    clock.acquire();

    clock.release();

    expect(driver.calls).toEqual(["start"]);

    clock.release();

    expect(driver.calls).toEqual(["start", "stop"]);
  });

  test("restarts the rotation when a ring mounts again", () => {
    const driver = createRecordingDriver();
    const clock = createOrbitClock(driver);
    clock.acquire();
    clock.release();

    clock.acquire();

    expect(driver.calls).toEqual(["start", "stop", "start"]);
  });

  test("ignores a release with no ring mounted, so the next mount still rotates", () => {
    const driver = createRecordingDriver();
    const clock = createOrbitClock(driver);

    clock.release();
    clock.release();
    clock.acquire();

    expect(driver.calls).toEqual(["start"]);
  });
});
