"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import { useTheme } from "@/lib/theme";
import { mono, F, R, projectColor } from "@/lib/tokens";
import { tagDisplayName } from "@/lib/tags";
import { useNavigation } from "@/lib/contexts";
export default function NavBar(props) {
  const { C } = useTheme();
  const { activeProject, searchOpen, setSearchOpen, searchQuery, setSearchQuery, searchInputRef, srLoading, date, token, userId, onSelectProject, onBack } = props;
