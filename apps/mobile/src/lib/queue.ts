import AsyncStorage from "@react-native-async-storage/async-storage";
import { createCommandQueue } from "./command-queue";
export type { QueuedCommand, CommandOwner } from "./command-queue";
const queue = createCommandQueue(AsyncStorage);
export const readQueue = queue.read;
export const enqueue = queue.enqueue;
export const updateQueued = queue.update;
export const removeQueued = queue.remove;
export const ownsQueued = queue.owns;
