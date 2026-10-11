import {
  createContext,
  useContext,
  useEffect,
  useState,
} from 'react';

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
    try {
      localStorage.setItem(
        'shelf_visitor_appearance',
        isDarkAppearance ? 'dark' : 'light'
      );
    } catch {
      // Theme preference cannot be saved.
    }
  }, [isDarkAppearance]);

  const toggleTheme = () => {
    setIsDarkAppearance((current) => !current);
  };

  return (
    <ThemeContext.Provider
      value={{
        isDarkAppearance,
        setIsDarkAppearance,
        toggleTheme,
      }}
    >
      <div className={isDarkAppearance ? 'dark' : ''}>
        {children}
      </div>
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