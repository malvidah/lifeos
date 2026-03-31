"use client";
import { createContext, useContext } from "react";

// Navigation context — lets editors navigate to projects or notes on chip click
export const NavigationContext = createContext({ navigateToProject: () => {}, navigateToNote: () => {} });
export function useNavigation() { return useContext(NavigationContext); }

// Project names — passes known project names to editors for {tag} autocomplete
export const ProjectNamesContext = createContext([]);
export function useProjectNames() { return useContext(ProjectNamesContext); }

// Place names — passes known place names to editors for /l autocomplete
export const PlaceNamesContext = createContext([]);
export function usePlaceNames() { return useContext(PlaceNamesContext); }

// Note context — provides note names to editors for /n suggestions, and drawing names for /d suggestions
export const NoteContext = createContext({ notes: [], drawings: [] });
