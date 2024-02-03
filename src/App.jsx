import { useState } from "react";

export default function App() {
  const [count, setCount] = useState(0);

  return (
    <button onClick={() => setCount((count) => count + 1)}>
      count is {count}
    </button>
  );
}
if (import.meta.hot) {
  import.meta.hot.accept(() => {
    import.meta.hot.invalidate();
  });
}
