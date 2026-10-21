import { AnimatePresence, motion } from "motion/react";
import { TriangleAlert } from "lucide-react";

/** Red alert strip. Glitches in once, stays static, slides away when the error clears. */
export function ErrorBanner({ message }: { message: string | null }) {
  return (
    <AnimatePresence initial={false}>
      {message && (
        <motion.div
          key="banner"
          role="alert"
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.3 }}
          className="relative z-10 overflow-hidden"
        >
          <p
            key={message}
            className="glitch-once m-0 flex items-center gap-3 border-y border-danger/70 bg-danger/10 px-4 py-2 text-sm font-bold text-danger"
          >
            <TriangleAlert className="size-5 shrink-0" aria-hidden="true" />
            <span className="font-display tracking-widest">ALERT</span>
            <span className="min-w-0 break-words font-normal text-text">{message}</span>
          </p>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
