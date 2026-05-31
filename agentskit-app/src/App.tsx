import { ChatContainer, InputBar, Message, useChat } from '@agentskit/react'
import '@agentskit/react/theme'

function demoAdapter() {
  return {
    createSource: () => ({
      stream: async function* () {
        yield { type: 'text' as const, content: 'Hello from your AgentsKit starter. ' }
        yield { type: 'text' as const, content: 'Configure a real adapter to talk to a model.' }
        yield { type: 'done' as const }
      },
      abort: () => {},
    }),
  }
}

export default function App() {
  const chat = useChat({
    adapter: demoAdapter(),
  })

  return (
    <ChatContainer>
      {chat.messages.map(message => (
        <Message key={message.id} message={message} />
      ))}
      <InputBar chat={chat} />
    </ChatContainer>
  )
}
