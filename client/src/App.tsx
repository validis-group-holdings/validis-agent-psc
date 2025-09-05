import { useState } from 'react'
import { queryAgent, type QueryRequest } from './api/client'
import './App.css'

function App() {
  const [query, setQuery] = useState('')
  const [workflowMode, setWorkflowMode] = useState<'audit' | 'lending'>('audit')
  const [response, setResponse] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [clientId] = useState(() => `client-${Date.now()}`)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!query.trim()) return

    setIsLoading(true)
    setResponse('')

    try {
      const request: QueryRequest = {
        query: query.trim(),
        clientId,
        workflowMode
      }

      const result = await queryAgent(request)
      
      if (result.success) {
        setResponse(result.response)
      } else {
        setResponse(`Error: ${result.error}`)
      }
    } catch (error) {
      setResponse(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="app">
      <header>
        <h1>Validis Agent</h1>
        <p>AI-powered business intelligence chat interface</p>
      </header>

      <main>
        <form onSubmit={handleSubmit} className="query-form">
          <div className="form-group">
            <label htmlFor="workflowMode">Workflow Mode:</label>
            <select
              id="workflowMode"
              value={workflowMode}
              onChange={(e) => setWorkflowMode(e.target.value as 'audit' | 'lending')}
            >
              <option value="audit">Audit</option>
              <option value="lending">Lending</option>
            </select>
          </div>

          <div className="form-group">
            <label htmlFor="query">Query:</label>
            <textarea
              id="query"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Ask a question about your business data..."
              rows={3}
              disabled={isLoading}
            />
          </div>

          <button type="submit" disabled={isLoading || !query.trim()}>
            {isLoading ? 'Processing...' : 'Send Query'}
          </button>
        </form>

        {response && (
          <div className="response-section">
            <h3>Response:</h3>
            <div className="response-content">
              {response}
            </div>
          </div>
        )}
      </main>
    </div>
  )
}

export default App
