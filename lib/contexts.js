"use client";
import { createContext, useContext } from "react";

// Navigation context — lets editors navigate to projects or notes on chip click
export const NavigationContext = createContext({ navigateToProject: () => {}, navigateToNote: () => {} });
export function useNavigation() { return useContext(NavigationContext); }

// Project names — passes known project names to editors for {tag} autocomplete
export const ProjectNamesContext = createContext([]);
export function useProjectNames() { return useContext(ProjectNamesContext); }

// Note context — provides note names to editors for /n suggestions
export const NoteContext = createContext({ notes: [] });
