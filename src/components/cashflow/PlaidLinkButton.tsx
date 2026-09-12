import { useCallback, useEffect, useState } from "react";
import { usePlaidLink } from "react-plaid-link";
import { Button } from "./Button";

interface Props {
  linkToken: string;
  label: string;
  onExchange: (publicToken: string, institutionId?: string, institutionName?: string) => void;
  onExit: () => void;
}

/** Client-only Plaid Link launcher. Opens as soon as the token is ready. */
export default function PlaidLinkButton({ linkToken, label, onExchange, onExit }: Props) {
  const [done, setDone] = useState(false);

  const onSuccess = useCallback(
    (publicToken: string, metadata: { institution?: { institution_id?: string; name?: string } | null }) => {
      setDone(true);
      onExchange(publicToken, metadata.institution?.institution_id, metadata.institution?.name);
    },
    [onExchange],
  );

  const { open, ready } = usePlaidLink({
    token: linkToken,
    onSuccess,
    onExit: () => {
      if (!done) onExit();
    },
  });

  useEffect(() => {
    if (ready) open();
  }, [ready, open]);

  return (
    <Button variant="primary" onClick={() => open()} disabled={!ready}>
      {label}
    </Button>
  );
}
