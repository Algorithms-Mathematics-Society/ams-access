import styles from "./AccessLogo.module.css";

export function AccessLogo() {
  return <span role="img" aria-label="Access" className={styles.logo} />;
}

export function AccessMark({ className = "" }: { className?: string }) {
  return <span role="img" aria-label="Access" className={`${styles.mark} ${className}`} />;
}

export function AccessWordmark({ className = "" }: { className?: string }) {
  return <span role="img" aria-label="Access" className={`${styles.wordmark} ${className}`} />;
}
