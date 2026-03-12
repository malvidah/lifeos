"use client";
import { useState, useEffect, useRef } from "react";
import { useTheme } from "@/lib/theme";
import { mono, F, R, blurweb } from "@/lib/tokens";
import { createClient } from "@/lib/supabase";
import { dbLoad, dbSave } from "@/lib/db";
import { IntegrationToggle, IntegrationRow, InfoTip, Card, DayLabLoader } from "../ui/primitives.jsx";
export default function UserMenu({session,token,userId,theme,onThemeChange,stravaConnected,onStravaChange}) {
  const { C } = useTheme();
