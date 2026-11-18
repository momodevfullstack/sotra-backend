CREATE TABLE IF NOT EXISTS taux (
  id INT AUTO_INCREMENT PRIMARY KEY,
  id_college INT NOT NULL,
  id_type_etablissement INT NOT NULL,
  taux_couverture DECIMAL(5,2) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_taux_college FOREIGN KEY (id_college) REFERENCES colleges(id) ON DELETE CASCADE,
  CONSTRAINT fk_taux_type_etablissement FOREIGN KEY (id_type_etablissement) REFERENCES type_etablissement(id) ON DELETE CASCADE,
  UNIQUE KEY uq_taux_college_type (id_college, id_type_etablissement)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Optionnel : s’assurer que le taux est dans la plage attendue
ALTER TABLE taux
  ADD CONSTRAINT chk_taux_range CHECK (taux_couverture BETWEEN 0 AND 100);
