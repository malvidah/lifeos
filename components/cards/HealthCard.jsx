"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import { useTheme } from "@/lib/theme";
import { mono, F, R } from "@/lib/tokens";
import { toKey, todayKey } from "@/lib/dates";
import { useDbSave, dbLoad, MEM, DIRTY } from "@/lib/db";
import { cachedOuraFetch, _ouraCache } from "@/lib/ouraCache";
import { createClient } from "@/lib/supabase";
import { Card, Ring, Widget, Shimmer, ChevronBtn, InfoTip } from "../ui/primitives.jsx";
export default function HealthCard({date,token,userId,onHealthChange,onScoresReady,onSyncStart,onSyncEnd,collapsed,onToggle,backAction}) {
  const { C } = useTheme();
