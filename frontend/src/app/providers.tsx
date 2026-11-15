import { QueryClientProvider } from '@tanstack/react-query'
import type { PropsWithChildren } from 'react'
import { BrowserRouter } from 'react-router'

import { ContentBlockedNotice } from '@/components/layout/content-blocked-notice'
import { queryClient } from '@/lib/query-client'

export function AppProviders({ children }: PropsWithChildren) {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        {children}
        <ContentBlockedNotice />
      </BrowserRouter>
    </QueryClientProvider>
  )
}
