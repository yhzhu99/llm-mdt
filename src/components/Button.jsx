import './Button.css';

export default function Button({
  className = '',
  variant = 'default', // default | ghost | danger
  ...props
}) {
  const classes = ['btn'];
  if (variant && variant !== 'default') classes.push(variant);
  if (className) classes.push(className);

  return <button {...props} className={classes.join(' ')} />;
}

