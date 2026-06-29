// 브랜드 마크 — app/icon.svg(파비콘)와 동일한 동심원 타깃. 랜딩 헤더·연결 화면에서
// 이모지 대신 재사용해 일관된 아이덴티티를 준다. 기본은 장식(aria-hidden); 의미가
// 필요한 곳은 label을 넘기면 img 역할로 노출된다.
export function Logo({
  size = 56,
  className,
  label,
}: {
  size?: number;
  className?: string;
  label?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      className={className}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <rect width="32" height="32" rx="7" fill="#0b0b10" />
      <circle cx="16" cy="16" r="11" fill="none" stroke="#ef4444" strokeWidth="3" />
      <circle cx="16" cy="16" r="6" fill="none" stroke="#fbbf24" strokeWidth="3" />
      <circle cx="16" cy="16" r="1.8" fill="#fbbf24" />
    </svg>
  );
}
