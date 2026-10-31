-- App Attest assertions (iOS): each card authorization is signed by the Secure Enclave key
-- the device attested, with a counter that only goes up. The highest counter accepted is
-- kept per device; a new attestation (a new key) resets it.
ALTER TABLE devices ADD COLUMN app_attest_counter BIGINT;
