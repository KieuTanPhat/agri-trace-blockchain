import AsyncStorage from "@react-native-async-storage/async-storage";
import { createAnnouncementReadStore } from "./read-state";
export const announcementReadState = createAnnouncementReadStore(AsyncStorage);
