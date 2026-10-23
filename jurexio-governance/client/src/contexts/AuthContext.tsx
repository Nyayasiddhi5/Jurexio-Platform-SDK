import React, { createContext, useContext } from 'react';

interface User {
  id: string | number;
  name: string;
  email: string;
  avatar?: string;
  role: string;
  subscriptionTier: string;
  subscriptionStatus: string;
  organizationId?: string | number;
  organization_id?: string | number;
}

interface AuthContextValue {
  user: User | null;
  login: (user: User) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  login: () => {},
  logout: () => {},
});

interface AuthProviderProps {
  children: React.ReactNode;
  user: User | null;
  login: (user: User) => void;
  logout: () => void;
}

export function AuthProvider({ children, user, login, logout }: AuthProviderProps) {
  return (
    <AuthContext.Provider value={{ user, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
