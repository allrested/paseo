import Constants from "expo-constants";

/** F-Droid build without proprietary camera or notification dependencies. */
export const isFdroidBuild = Constants.expoConfig?.extra?.fdroidBuild === true;

/** The fork's own app (APP_VARIANT=fork), which carries the Flavours logo. */
export const isForkBuild = Constants.expoConfig?.extra?.forkBuild === true;

/** Production-like Android build with local profiling enabled. */
export const isProfileBuild = Constants.expoConfig?.extra?.profileBuild === true;
