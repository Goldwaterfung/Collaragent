import './assets/main.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from './App'
import { ProjectSessionProvider } from '@workspace/contexts/project/ProjectSession'
import { RelationalLedgerProvider } from '@workspace/contexts/ledger/RelationalLedgerContext'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 30, // 30s
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
      retry: 1
    }
  }
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ProjectSessionProvider>
        <RelationalLedgerProvider>
          <App />
        </RelationalLedgerProvider>
      </ProjectSessionProvider>
    </QueryClientProvider>
  </StrictMode>
)
