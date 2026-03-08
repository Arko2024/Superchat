import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import * as dotenv from 'dotenv'

dotenv.config()

// https://vitejs.dev/config/
export default defineConfig({
  server: {
    proxy: {
      '/openai-api': {
        target: 'https://api.openai.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/openai-api/, ''),
      },
    },
  },
  plugins: [
    react(),
    {
      name: 'api-handler',
      configureServer(server) {
        server.middlewares.use(async (req, res, next) => {
          if (req.url === '/api/create-lead' && req.method === 'POST') {
            let body = ''
            req.on('data', chunk => { body += chunk })
            req.on('end', async () => {
              try {
                const { name, phone, businessId } = JSON.parse(body)
                // Use dynamic import to avoid issues with SSR/Dev mode
                const handler = (await import('./api/create-lead.js')).default || (await import('./api/create-lead.js'))

                // Construct a mock response object
                const mockRes = {
                  status(code) {
                    res.statusCode = code
                    return this
                  },
                  json(data) {
                    res.setHeader('Content-Type', 'application/json')
                    res.end(JSON.stringify(data))
                    return this
                  }
                }

                const mockReq = {
                  method: 'POST',
                  body: JSON.parse(body)
                }

                await handler(mockReq, mockRes)
              } catch (err) {
                console.error('API Dev Handler Error:', err)
                res.statusCode = 500
                res.end(JSON.stringify({ error: 'Local API Dev Error' }))
              }
            })
            return
          }
          next()
        })
      }
    }
  ],
})
