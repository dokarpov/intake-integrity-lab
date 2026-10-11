# Recovery and disaster-recovery verification

A successful database restore is not sufficient. Recovery is complete only when:

1. the full event chain verifies;
2. sequence continuity is intact;
3. the latest signed checkpoint verifies;
4. at least the configured immutable-archive quorum remains reachable;
5. archive object checksums match receipts;
6. signing/HMAC/encryption key references are still resolvable according to lifecycle policy;
7. any encrypted archive selected for test recovery can be decrypted and its checkpoint reverified.

`npm run recovery:verify -- recovered-events.json` performs the chain part locally. Real deployments should run an automated restore drill against an isolated environment and retain the drill evidence as another control event.
