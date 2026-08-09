import { useEffect, useMemo } from "react";
import { StyleSheet, View } from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  makeMutable,
  useAnimatedStyle,
  useReducedMotion,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import Svg, { Circle } from "react-native-svg";
import { createOrbitClock } from "@/components/orbit-status-ring-clock";
import { useRetainedPanelActive } from "@/components/retained-panel";

// The busy affordance for a status dot. Every status in the sidebar is a dot; busy is the one
// with something moving around it. Callers own the color and the geometry and pass both in —
// this module owns nothing but the rotation.
//
// Rotation only, and only on the ring. The dot itself never changes fill, opacity, or size:
//
//   - Opacity is off the table. Fading the dot blends it toward the row's surface rather than
//     toward black, and the bottom of the cycle read as the success dot one row up. Chroma
//     cannot rescue it either — blue at these lightnesses is already at the sRGB gamut edge.
//     That is what got the previous pulse removed.
//   - Size is off the table. The dot sits in a column of static dots in neighboring rows, so
//     anything that changes its size reads as jitter down the list.
//
// Motion cannot be confused with another hue, which is why the ring works where the pulse did
// not. The faint full-circle track is what keeps it from being too subtle: an arc alone on
// empty background disappears at this size, but an arc moving against a visible track catches
// the eye peripherally in a long list.
//
// Drawn with SVG rather than a rounded View with one colored border side. Per-side border
// colors combined with a border radius are not rendered consistently across iOS, Android and
// RNW, and the way that fails here is silent: the arc becomes a complete circle and the ring
// stops reading as motion at all.
const ORBIT_PERIOD_MS = 1680;
const RING_STROKE = 1;
// A quarter turn of ink. Shorter reads as a speck circling nothing; much longer and the gap
// closes up until the ring is just a circle.
const ARC_FRACTION = 0.25;
// The track has to stay well below the arc or the ring reads as a solid circle with a bright
// spot rather than as something travelling.
const TRACK_OPACITY = 0.22;

// One clock for every ring in the app. Rings that each start their own animation drift apart
// as rows mount at different times, and a column of them turning out of step is noise — the
// same reason SyncedLoader drives all its instances from a single step. The value *is* the
// angle, so subscribers read it directly and there is nothing per-instance to fall out of
// phase. Refcounting lives in orbit-status-ring-clock.ts.
const rotation = makeMutable(0);

const rotationClock = createOrbitClock({
  start() {
    rotation.value = withRepeat(
      withTiming(360, { duration: ORBIT_PERIOD_MS, easing: Easing.linear }),
      -1,
      false,
    );
  },
  stop() {
    cancelAnimation(rotation);
    rotation.value = 0;
  },
});

/** A status dot with an arc orbiting it, in step with every other ring on screen. */
export function OrbitStatusRing({
  color,
  size,
  dotSize,
  testID,
}: {
  color: string;
  size: number;
  dotSize: number;
  testID?: string;
}) {
  const active = useRetainedPanelActive();
  const reduceMotion = useReducedMotion();
  const animate = active && !reduceMotion;

  useEffect(() => {
    if (!animate) {
      return;
    }
    rotationClock.acquire();
    return () => rotationClock.release();
  }, [animate]);

  const rotationStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotation.value}deg` }],
  }));

  const containerStyle = useMemo(() => ({ width: size, height: size }), [size]);
  // The stroke straddles the path, so the radius is inset by half of it to keep the ring
  // inside the box the caller sized.
  const radius = (size - RING_STROKE) / 2;
  const circumference = 2 * Math.PI * radius;
  const arcLength = circumference * ARC_FRACTION;
  const arcStyle = useMemo(
    () => [styles.ring, { width: size, height: size }, rotationStyle],
    [rotationStyle, size],
  );
  const coreStyle = useMemo(
    () => ({
      width: dotSize,
      height: dotSize,
      borderRadius: dotSize / 2,
      backgroundColor: color,
    }),
    [color, dotSize],
  );

  // Reduced motion falls back to the bare dot. It still carries the running color, and the
  // status is spelled out in the surrounding row's accessible label either way.
  return (
    <View style={[styles.container, containerStyle]} testID={testID}>
      {reduceMotion ? null : (
        // The track is inside the rotating layer too. It is a full circle, so turning it
        // changes nothing, and one SVG is cheaper than two.
        <Animated.View style={arcStyle} pointerEvents="none">
          <Svg width={size} height={size}>
            <Circle
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              stroke={color}
              strokeWidth={RING_STROKE}
              strokeOpacity={TRACK_OPACITY}
            />
            <Circle
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              stroke={color}
              strokeWidth={RING_STROKE}
              strokeLinecap="round"
              strokeDasharray={`${arcLength} ${circumference - arcLength}`}
            />
          </Svg>
        </Animated.View>
      )}
      <View style={coreStyle} />
    </View>
  );
}

// Plain React Native styles, not Unistyles: a themed StyleSheet applied to a Reanimated
// Animated.View crashes on theme change (docs/unistyles.md). The color arrives as a prop.
const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    justifyContent: "center",
  },
  ring: {
    position: "absolute",
  },
});
