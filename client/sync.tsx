import { Icon } from "@getpaseo/plugin/client/react-native";
import { Text, View } from "react-native";
import type { SyncMode, SyncState } from "../shared/prompts";
import { Chip, IconButton, Segmented, relativeTime, type Colors } from "./ui";

const INTERVALS = [5, 15, 30, 60] as const;

const MODES = [
  { value: "manual", label: "Manual", icon: "Hand" },
  { value: "changes", label: "Automatic", icon: "Zap" },
  { value: "interval", label: "Scheduled", icon: "Clock" },
] as const;

export function describeMode(mode: SyncMode, interval: number) {
  if (mode === "changes") return "Syncs a few seconds after each change, and pulls when you open the library.";
  if (mode === "interval") return `Syncs every ${formatInterval(interval)}, and pulls when you open the library.`;
  return "Syncs only when you choose Sync now.";
}

function formatInterval(minutes: number) {
  if (minutes % 60 === 0) return minutes === 60 ? "hour" : `${minutes / 60} hours`;
  return minutes === 1 ? "minute" : `${minutes} minutes`;
}

function shortMode(state: SyncState) {
  if (state.mode === "changes") return "auto";
  if (state.mode === "interval") return `every ${state.interval < 60 || state.interval % 60 ? `${state.interval}m` : `${state.interval / 60}h`}`;
  return "manual";
}

/** One-line sync status with a Sync now button, for the library sidebar. */
export function SyncBadge({ colors, state, disabled, onSync }: { colors: Colors; state: SyncState; disabled: boolean; onSync: () => void }) {
  const failed = !state.running && state.lastError !== "";
  const label = state.running ? "Syncing…"
    : failed ? "Sync failed"
    : state.lastSyncedAt ? `Synced ${relativeTime(state.lastSyncedAt)}` : "Not synced yet";
  const tone = failed ? colors.statusDanger : state.running ? colors.accent : colors.foregroundMuted;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6, minWidth: 0 }}>
      <Icon name={state.running ? "LoaderCircle" : failed ? "CircleAlert" : "GitBranch"} size={13} color={tone} />
      <Text numberOfLines={1} accessibilityLabel={failed ? `Sync failed: ${state.lastError}` : undefined} style={{ color: tone, fontSize: 11, flex: 1, minWidth: 0 }}>
        {label} · {shortMode(state)}{failed ? ` · ${state.lastError}` : ""}
      </Text>
      <IconButton icon="RefreshCw" label="Sync now" onPress={onSync} colors={colors} disabled={disabled || state.running} size={26} />
    </View>
  );
}

type PickerProps = {
  colors: Colors;
  mode: SyncMode;
  interval: number;
  disabled: boolean;
  onChange: (mode: SyncMode, interval: number) => void;
};

/** Chooses when Git sync runs: manual, after changes, or on an interval. */
export function SyncModePicker({ colors, mode, interval, disabled, onChange }: PickerProps) {
  return (
    <View style={{ gap: 10 }}>
      <View style={{ flexDirection: "row" }}>
        <Segmented options={MODES} value={mode} onChange={(value) => onChange(value, interval)} colors={colors} disabled={disabled} />
      </View>
      <Text style={{ color: colors.foregroundMuted, fontSize: 12, lineHeight: 17 }}>{describeMode(mode, interval)}</Text>
      {mode === "interval" && (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
          {INTERVALS.map((minutes) => (
            <Chip key={minutes} icon="Clock" label={`Every ${formatInterval(minutes)}`} active={interval === minutes} onPress={() => onChange("interval", minutes)} colors={colors} disabled={disabled} />
          ))}
        </View>
      )}
    </View>
  );
}
