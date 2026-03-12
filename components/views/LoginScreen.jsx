"use client";
import { useTheme } from "@/lib/theme";
import { mono, F, blurweb } from "@/lib/tokens";
import { createClient } from "@/lib/supabase";
export default function LoginScreen() {
  const { C } = useTheme();
