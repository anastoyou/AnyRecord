import { useEffect, useState, type ReactElement } from "react";
import { Button } from "@/components/ui/button";
import {
	Gear,
	MagicWand,
	MicrophoneSlashIcon,
	SpeakerHighIcon,
	SpeakerXIcon,
} from "@/components/ui/icons";
import { Switch } from "@/components/ui/switch";
import { useScopedT } from "@/contexts/I18nContext";
import { useNoiseSuppressionPreferences } from "@/hooks/useNoiseSuppressionPreferences";
import styles from "../LaunchWindow.module.css";
import { useLaunchPopoverCoordinator } from "./LaunchPopoverCoordinator";
import { LiveAudioSettingsPanel } from "./LiveAudioSettingsDialog";
import type { DeviceOption } from "./launchPopoverTypes";
import { DropdownItem, HudPopover, MicDeviceRow } from "./PopoverScaffold";

const POPOVER_ID = "mic";

export function MicPopover({
	trigger,
	disabled,
	systemAudioEnabled,
	onToggleSystemAudio,
	microphoneEnabled,
	onDisableMicrophone,
	devices,
	microphoneDeviceId,
	selectedDeviceId,
	onSelectDevice,
}: {
	trigger: ReactElement;
	disabled?: boolean;
	systemAudioEnabled: boolean;
	onToggleSystemAudio: () => void;
	microphoneEnabled: boolean;
	onDisableMicrophone: () => void;
	devices: DeviceOption[];
	microphoneDeviceId?: string;
	selectedDeviceId?: string;
	onSelectDevice: (deviceId: string) => void;
}) {
	const t = useScopedT("launch");
	const { isOpen, requestOpen, requestClose } = useLaunchPopoverCoordinator();
	const { preferences, setEnabled, setLevel } = useNoiseSuppressionPreferences();
	const open = isOpen(POPOVER_ID);
	const [showSettings, setShowSettings] = useState(false);

	useEffect(() => {
		if (!open) {
			setShowSettings(false);
		}
	}, [open]);

	return (
		<HudPopover
			open={open}
			onOpenChange={(nextOpen) => {
				if (!nextOpen) {
					requestClose(POPOVER_ID);
					return;
				}
				if (disabled) {
					return;
				}
				requestOpen(POPOVER_ID);
			}}
			trigger={trigger}
			align="start"
		>
			{showSettings ? (
				<LiveAudioSettingsPanel
					open={open && showSettings}
					onBack={() => setShowSettings(false)}
					microphoneEnabled={microphoneEnabled}
					onEnableMicrophone={() => {
						const targetDevice =
							microphoneDeviceId ?? selectedDeviceId ?? devices[0]?.deviceId ?? "default";
						onSelectDevice(targetDevice);
					}}
					microphoneDeviceId={microphoneDeviceId}
				/>
			) : (
				<>
					<div className={styles.ddLabel}>{t("recording.microphone")}</div>
					<DropdownItem
						icon={
							systemAudioEnabled ? (
								<SpeakerHighIcon size={16} />
							) : (
								<SpeakerXIcon size={16} />
							)
						}
						selected={systemAudioEnabled}
						onClick={onToggleSystemAudio}
					>
						{systemAudioEnabled
							? t("recording.disableSystemAudio")
							: t("recording.enableSystemAudio")}
					</DropdownItem>
					<div className="flex h-9 items-center justify-between gap-2 rounded-lg px-3 text-sm">
						<div className="flex items-center gap-3 min-w-0">
							<MagicWand size={16} className="shrink-0" />
							<span className="truncate">Noise suppression</span>
						</div>
						<div className="flex items-center gap-1.5 shrink-0">
							<Switch
								aria-label="Noise suppression"
								checked={preferences.enabled}
								onCheckedChange={(checked) => {
									setEnabled(checked);
									if (checked && preferences.level === 0) {
										setLevel(75);
									}
								}}
							/>
							<Button
								variant="ghost"
								size="icon"
								iconSize="sm"
								onClick={() => setShowSettings(true)}
								aria-label="Noise suppression settings"
								title="Settings"
							>
								<Gear size={15} />
							</Button>
						</div>
					</div>
					{microphoneEnabled && (
						<DropdownItem
							icon={<MicrophoneSlashIcon size={16} />}
							onClick={() => {
								onDisableMicrophone();
								requestClose(POPOVER_ID);
							}}
						>
							{t("recording.turnOffMicrophone")}
						</DropdownItem>
					)}
					{!microphoneEnabled && (
						<div className="px-3 py-2 text-xs text-[var(--launch-text-muted)]">
							{t("recording.selectMicToEnable")}
						</div>
					)}
					{devices.map((device) => (
						<MicDeviceRow
							key={device.deviceId}
							device={device}
							selected={
								microphoneEnabled &&
								(microphoneDeviceId === device.deviceId ||
									selectedDeviceId === device.deviceId)
							}
							onSelect={() => onSelectDevice(device.deviceId)}
						/>
					))}
					{devices.length === 0 && (
						<div className="text-center text-xs text-[var(--launch-text-muted)] py-4">
							{t("recording.noMicrophonesFound")}
						</div>
					)}
				</>
			)}
		</HudPopover>
	);
}
