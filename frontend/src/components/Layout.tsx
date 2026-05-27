import React, { useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import TopNavBar from './TopNavBar';
import AliasModal from './AliasModal';
import { useAlias } from '../hooks/useAlias';

const Layout: React.FC = () => {
  const { alias, setAlias, isLoaded } = useAlias();
  const [isAliasModalOpen, setIsAliasModalOpen] = useState(false);

  const location = useLocation();
  const isGameRoute = location.pathname === "/";

  return (
    <div className={`app-shell ${!isGameRoute ? 'no-sidebar' : ''}`}>
      <TopNavBar
        alias={alias}
        onEditAlias={() => setIsAliasModalOpen(true)}
      />
      
      <Outlet />

      <AliasModal
        isOpen={isAliasModalOpen || (isLoaded && !alias)}
        initialAlias={alias}
        onSave={(newAlias) => {
          setAlias(newAlias);
          setIsAliasModalOpen(false);
        }}
        onCancel={() => setIsAliasModalOpen(false)}
        forceRequired={!alias}
      />
    </div>
  );
};

export default Layout;
