-- CodeRank MySQL Baseline Schema
-- Used exclusively for DBMS performance benchmarking against Redis
-- Application operational data resides 100% in Redis.

CREATE TABLE IF NOT EXISTS users (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(50) NOT NULL UNIQUE,
  score INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_score (score DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS problems (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(150) NOT NULL,
  difficulty VARCHAR(20) NOT NULL,
  points INT NOT NULL DEFAULT 100,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS submissions (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  problem_id INT NOT NULL,
  verdict VARCHAR(20) NOT NULL,
  points INT NOT NULL DEFAULT 0,
  submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_user (user_id),
  INDEX idx_problem (problem_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Dedicated benchmark table for 100,000 scale test
CREATE TABLE IF NOT EXISTS bench_users (
  id INT NOT NULL PRIMARY KEY,
  username VARCHAR(50) NOT NULL,
  score INT NOT NULL DEFAULT 0,
  INDEX idx_score (score DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
