export function FilterSelect({ icon: Icon, value, onChange, options }) {
  return (
    <label className="developer-select">
      {Icon ? <Icon className="h-4 w-4" /> : null}
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

