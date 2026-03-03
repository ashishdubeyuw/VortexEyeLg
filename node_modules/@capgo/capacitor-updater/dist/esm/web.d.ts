import { WebPlugin } from "@capacitor/core";
import type { CapacitorUpdaterPlugin, BundleInfo, LatestVersion, DelayCondition, ChannelRes, SetChannelOptions, GetChannelRes, SetCustomIdOptions, UnsetChannelOptions, StatsUrl, UpdateUrl, ChannelUrl, DownloadOptions, BundleId, AutoUpdateEnabled, DeviceId, BuiltinVersion, PluginVersion, BundleListResult, ResetOptions, CurrentBundleResult, AppReadyResult, MultiDelayConditions } from "./definitions";
export declare class CapacitorUpdaterWeb extends WebPlugin implements CapacitorUpdaterPlugin {
    setStatsUrl(options: StatsUrl): Promise<void>;
    setUpdateUrl(options: UpdateUrl): Promise<void>;
    setChannelUrl(options: ChannelUrl): Promise<void>;
    download(options: DownloadOptions): Promise<BundleInfo>;
    next(options: BundleId): Promise<BundleInfo>;
    isAutoUpdateEnabled(): Promise<AutoUpdateEnabled>;
    set(options: BundleId): Promise<void>;
    getDeviceId(): Promise<DeviceId>;
    getBuiltinVersion(): Promise<BuiltinVersion>;
    getPluginVersion(): Promise<PluginVersion>;
    delete(options: BundleId): Promise<void>;
    list(): Promise<BundleListResult>;
    reset(options?: ResetOptions): Promise<void>;
    current(): Promise<CurrentBundleResult>;
    reload(): Promise<void>;
    getLatest(): Promise<LatestVersion>;
    setChannel(options: SetChannelOptions): Promise<ChannelRes>;
    unsetChannel(options: UnsetChannelOptions): Promise<void>;
    setCustomId(options: SetCustomIdOptions): Promise<void>;
    getChannel(): Promise<GetChannelRes>;
    notifyAppReady(): Promise<AppReadyResult>;
    setMultiDelay(options: MultiDelayConditions): Promise<void>;
    setDelay(option: DelayCondition): Promise<void>;
    cancelDelay(): Promise<void>;
}
