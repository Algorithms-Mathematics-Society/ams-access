'use client';

import type { ReactNode } from 'react';
import { Theme as AstryxTheme } from '@astryxdesign/core/theme';
import { useTheme } from '@/lib/theme';
import { useDarkLocked } from '@/lib/theme-dark-lock';
import { effectiveTheme } from '@/lib/theme-bridge-core';
import { accessTheme } from '@/theme/access';

/** One visual theme, driven by the app's existing preference and route policy. */
export function AccessThemeProvider({ children }: { children: ReactNode }) {
  const { theme } = useTheme();
  const darkLocked = useDarkLocked();
  return (
    <AstryxTheme theme={accessTheme} mode={effectiveTheme(theme, darkLocked)}>
      {children}
    </AstryxTheme>
  );
}
