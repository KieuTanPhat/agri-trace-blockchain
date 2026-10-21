import AsyncStorage from "@react-native-async-storage/async-storage";
import { createHistoryStore } from "./history";

export const localHistory = createHistoryStore(AsyncStorage);
