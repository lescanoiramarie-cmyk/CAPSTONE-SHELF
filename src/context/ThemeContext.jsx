import { createContext, useContext, useEffect, useState } from 'react';

const ThemeContext = createContext(null);

function getSavedTheme() {
  try {
    return localStorage.getItem('shelf_visitor_appearance') === 'dark';
  } catch {
    return false;
  }
}

export function ThemeProvider({ children }) {
  const [isDarkAppearance, setIsDarkAppearance] = useState(getSavedTheme);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDarkAppearance);

    try {
      localStorage.setItem(
        'shelf_visitor_appearance',
        isDarkAppearance ? 'dark' : 'light'
      );
    } catch {
      // The theme still applies for the current session.
    }

    return () => {
      document.documentElement.classList.remove('dark');
    };
  }, [isDarkAppearance]);

  const toggleTheme = () => {
    setIsDarkAppearance((current) => !current);
  };

  return (
    <ThemeContext.Provider
      value={{ isDarkAppearance, setIsDarkAppearance, toggleTheme }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);

  if (!context) {
    throw new Error('useTheme must be used inside ThemeProvider');
  }

  return context;
}
