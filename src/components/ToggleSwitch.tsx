import React from 'react';

interface ToggleSwitchProps {
  id?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  ariaLabel?: string;
}

export const ToggleSwitch: React.FC<ToggleSwitchProps> = ({
  id,
  checked,
  onChange,
  ariaLabel,
}) => {
  return (
    <button
      id={id}
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      onClick={() => onChange(!checked)}
      className={`relative flex items-center w-[46px] h-[26px] rounded-full border-2 transition-colors duration-200 shrink-0 ${
        checked
          ? 'bg-[var(--color-primary)] border-[var(--color-primary)]'
          : 'bg-[var(--color-surface-container-highest)] border-[var(--color-outline)]'
      }`}
    >
      <span
        className={`absolute top-[2px] w-[18px] h-[18px] rounded-full transition-all duration-200 ${
          checked
            ? 'bg-[var(--color-on-primary)] left-[3px]'
            : 'bg-[var(--color-outline)] left-[21px]'
        }`}
      />
    </button>
  );
};
