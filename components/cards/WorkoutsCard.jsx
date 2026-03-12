"use client";
import { useState, useEffect, useRef, useCallback, Fragment } from "react";
import { useTheme } from "@/lib/theme";
import { mono, F, R } from "@/lib/tokens";
import { toKey, todayKey } from "@/lib/dates";
import { useDbSave, dbLoad } from "@/lib/db";
import { fmtMins, sportEmoji } from "@/lib/formatting";
export default function WorkoutsCard({date,token,userId,stravaConnected}) {
  const { C } = useTheme();
