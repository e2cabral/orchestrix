import { create } from "./src"

(async () => {
  const orchestrator = create(
    'new-flow',
    {
      hooks: {

      }
    }
  )
})()