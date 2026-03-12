"use client";
import { useState, useEffect } from "react";
import { useTheme } from "@/lib/theme";
import { mono, F, blurweb } from "@/lib/tokens";
import { toKey, todayKey, DAYS_SHORT, MONTHS_SHORT } from "@/lib/dates";
import UserMenu from "./UserMenu.jsx";
export default function Header({session,token,userId,syncStatus,theme,onThemeChange,selected,onGoToToday,onGoHome,stravaConnected,onStravaChange}) {
  const { C } = useTheme();
