"use client";

import { useState } from "react";

/** Mốc thời gian cố định cho một lần mount — tránh gọi Date.now() trong render. */
export function useNow() {
  const [now] = useState(() => Date.now());
  return now;
}
